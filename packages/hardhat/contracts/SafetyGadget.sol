// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SafetyGadget
 * @notice Module 5: Attack Model & Reorg Safety Implementation
 * @dev Provides protection against:
 *      1. Time-Bandit attacks via lookback distance enforcement
 *      2. Chain reorganizations via blockhash ancestry verification
 *      3. Double-settlement/replay attacks via nullifier pattern
 * 
 * Based on research specifications from Module 5:
 * - Lookback distance of 64 blocks (~12-15 mins on Ethereum)
 * - Nullifier = keccak256(sender || nonce || payloadHash || chainId)
 * - Ancestry verification using blockhash checks
 */
abstract contract SafetyGadget {
    // ============================================================
    //                        CONSTANTS
    // ============================================================

    /**
     * @notice Lookback distance in blocks before settlement can be finalized
     * @dev 64 blocks provides probabilistic finality on Ethereum PoS
     *      This prevents Time-Bandit attacks where miners rewrite recent history
     */
    uint256 public constant LOOKBACK_DISTANCE = 64;

    /**
     * @notice Maximum block age for which blockhash() returns non-zero
     * @dev EVM limitation - blockhash only works for last 256 blocks
     */
    uint256 public constant MAX_BLOCKHASH_AGE = 256;

    // ============================================================
    //                     FINALITY STATUS
    // ============================================================

    /**
     * @notice Finality status enum as per Module 5 spec
     * @dev PENDING: Transaction submitted but not yet logged
     *      LOGGED: Transaction included in a block
     *      CHECKPOINTED: Transaction is beyond lookback distance (safe from reorg)
     */
    enum FinalityStatus {
        PENDING,
        LOGGED,
        CHECKPOINTED
    }

    // ============================================================
    //                         STATE
    // ============================================================

    /**
     * @notice Mapping of nullifiers to track consumed settlement actions
     * @dev Nullifier = keccak256(sender || nonce || payloadHash || chainId)
     *      Once consumed, the same action cannot be replayed
     */
    mapping(bytes32 => bool) public nullifiers;

    /**
     * @notice Snapshot of chain state at commitment time
     * @param blockNumber The block number when snapshot was taken
     * @param blockHash The hash of the parent block at snapshot time
     * @param status Current finality status
     * @param exists Whether this snapshot has been initialized
     */
    struct ChainSnapshot {
        uint256 blockNumber;
        bytes32 blockHash;
        FinalityStatus status;
        bool exists;
    }

    /**
     * @notice Maps batch/settlement ID to its chain snapshot
     * @dev Used to verify ancestry and enforce lookback distance
     */
    mapping(bytes32 => ChainSnapshot) public chainSnapshots;

    // ============================================================
    //                         EVENTS
    // ============================================================

    /**
     * @notice Emitted when a nullifier is consumed
     * @param nullifier The consumed nullifier hash
     * @param sender The address that consumed the nullifier
     */
    event NullifierConsumed(bytes32 indexed nullifier, address indexed sender);

    /**
     * @notice Emitted when a chain snapshot is recorded
     * @param settlementId The settlement/batch ID
     * @param blockNumber The block number at snapshot time
     * @param blockHash The recorded block hash
     */
    event SnapshotRecorded(
        bytes32 indexed settlementId,
        uint256 blockNumber,
        bytes32 blockHash
    );

    /**
     * @notice Emitted when finality status changes
     * @param settlementId The settlement/batch ID
     * @param oldStatus Previous finality status
     * @param newStatus New finality status
     */
    event FinalityStatusChanged(
        bytes32 indexed settlementId,
        FinalityStatus oldStatus,
        FinalityStatus newStatus
    );

    /**
     * @notice Emitted when ancestry verification succeeds
     * @param settlementId The settlement/batch ID
     * @param verifiedAtBlock Block number where verification occurred
     */
    event AncestryVerified(bytes32 indexed settlementId, uint256 verifiedAtBlock);

    // ============================================================
    //                         ERRORS
    // ============================================================

    /// @notice Thrown when attempting to reuse a nullifier
    error NullifierAlreadyConsumed(bytes32 nullifier);

    /// @notice Thrown when lookback distance has not been met
    error LookbackDistanceNotMet(uint256 required, uint256 actual);

    /// @notice Thrown when a chain reorganization is detected
    error ReorgDetected(bytes32 expected, bytes32 actual);

    /// @notice Thrown when snapshot doesn't exist for given ID
    error SnapshotNotFound(bytes32 settlementId);

    /// @notice Thrown when blockhash is too old to verify
    error BlockhashTooOld(uint256 snapshotBlock, uint256 currentBlock);

    /// @notice Thrown when snapshot already exists
    error SnapshotAlreadyExists(bytes32 settlementId);

    // ============================================================
    //                    NULLIFIER FUNCTIONS
    // ============================================================

    /**
     * @notice Computes a nullifier for idempotence verification
     * @dev Nullifier = keccak256(sender || nonce || payloadHash || chainId)
     *      This binds the action to sender, sequence, content, AND chain
     * @param sender The address initiating the action
     * @param nonce The sender's nonce for this action
     * @param payloadHash Hash of the settlement payload data
     * @return The computed nullifier
     */
    function computeNullifier(
        address sender,
        uint256 nonce,
        bytes32 payloadHash
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(sender, nonce, payloadHash, block.chainid));
    }

    /**
     * @notice Checks if a nullifier has been consumed
     * @param nullifier The nullifier to check
     * @return True if already consumed, false otherwise
     */
    function isNullifierConsumed(bytes32 nullifier) public view returns (bool) {
        return nullifiers[nullifier];
    }

    /**
     * @notice Internal function to consume a nullifier
     * @dev Reverts if nullifier already consumed
     * @param sender The address initiating the action
     * @param nonce The sender's nonce
     * @param payloadHash Hash of the payload
     * @return nullifier The consumed nullifier
     */
    function _consumeNullifier(
        address sender,
        uint256 nonce,
        bytes32 payloadHash
    ) internal returns (bytes32 nullifier) {
        nullifier = computeNullifier(sender, nonce, payloadHash);
        
        if (nullifiers[nullifier]) {
            revert NullifierAlreadyConsumed(nullifier);
        }
        
        nullifiers[nullifier] = true;
        emit NullifierConsumed(nullifier, sender);
    }

    // ============================================================
    //                   SNAPSHOT FUNCTIONS
    // ============================================================

    /**
     * @notice Records a chain snapshot for a settlement
     * @dev Called when settlement enters PRE_COMMITTED state
     *      Records current block number and parent block hash
     * @param settlementId Unique identifier for the settlement
     */
    function _recordSnapshot(bytes32 settlementId) internal {
        if (chainSnapshots[settlementId].exists) {
            revert SnapshotAlreadyExists(settlementId);
        }

        // Record the parent block hash (current block hash is 0x0 during execution)
        bytes32 parentHash = blockhash(block.number - 1);
        
        chainSnapshots[settlementId] = ChainSnapshot({
            blockNumber: block.number,
            blockHash: parentHash,
            status: FinalityStatus.LOGGED,
            exists: true
        });

        emit SnapshotRecorded(settlementId, block.number, parentHash);
        emit FinalityStatusChanged(settlementId, FinalityStatus.PENDING, FinalityStatus.LOGGED);
    }

    /**
     * @notice Gets the chain snapshot for a settlement
     * @param settlementId The settlement ID to query
     * @return The chain snapshot struct
     */
    function getSnapshot(bytes32 settlementId) public view returns (ChainSnapshot memory) {
        return chainSnapshots[settlementId];
    }

    /**
     * @notice Gets the current finality status of a settlement
     * @param settlementId The settlement ID to query
     * @return The current finality status
     */
    function getFinalityStatus(bytes32 settlementId) public view returns (FinalityStatus) {
        ChainSnapshot memory snapshot = chainSnapshots[settlementId];
        if (!snapshot.exists) {
            return FinalityStatus.PENDING;
        }
        
        // Check if we've passed the lookback distance
        if (block.number >= snapshot.blockNumber + LOOKBACK_DISTANCE) {
            return FinalityStatus.CHECKPOINTED;
        }
        
        return FinalityStatus.LOGGED;
    }

    // ============================================================
    //                 ANCESTRY VERIFICATION
    // ============================================================

    /**
     * @notice Verifies that the chain has not reorganized since snapshot
     * @dev Performs two critical checks:
     *      1. Lookback distance: Enough blocks have passed
     *      2. Ancestry: The recorded blockhash is still in the canonical chain
     * @param settlementId The settlement ID to verify
     */
    function _verifyAncestry(bytes32 settlementId) internal {
        ChainSnapshot storage snapshot = chainSnapshots[settlementId];
        
        if (!snapshot.exists) {
            revert SnapshotNotFound(settlementId);
        }

        // Check 1: Lookback Distance
        uint256 blocksPassed = block.number - snapshot.blockNumber;
        if (blocksPassed < LOOKBACK_DISTANCE) {
            revert LookbackDistanceNotMet(LOOKBACK_DISTANCE, blocksPassed);
        }

        // Check 2: Ancestry Verification (Reorg Detection)
        // Note: blockhash() only works for the last 256 blocks
        uint256 snapshotParentBlock = snapshot.blockNumber - 1;
        
        if (block.number - snapshotParentBlock > MAX_BLOCKHASH_AGE) {
            // If too old, we can't verify via blockhash
            // In production, this would require an external oracle or archive node
            // For hackathon scope, we assume settlements complete within 256 blocks
            revert BlockhashTooOld(snapshotParentBlock, block.number);
        }

        bytes32 currentHashOfSnapshotParent = blockhash(snapshotParentBlock);
        
        if (currentHashOfSnapshotParent != snapshot.blockHash) {
            revert ReorgDetected(snapshot.blockHash, currentHashOfSnapshotParent);
        }

        // Update status to CHECKPOINTED
        FinalityStatus oldStatus = snapshot.status;
        snapshot.status = FinalityStatus.CHECKPOINTED;
        
        emit AncestryVerified(settlementId, block.number);
        emit FinalityStatusChanged(settlementId, oldStatus, FinalityStatus.CHECKPOINTED);
    }

    /**
     * @notice View function to check if ancestry can be verified
     * @dev Does not modify state, useful for off-chain checks
     * @param settlementId The settlement ID to check
     * @return canVerify Whether ancestry verification would succeed
     * @return reason Description of why verification would fail (empty if success)
     */
    function canVerifyAncestry(bytes32 settlementId) 
        public 
        view 
        returns (bool canVerify, string memory reason) 
    {
        ChainSnapshot memory snapshot = chainSnapshots[settlementId];
        
        if (!snapshot.exists) {
            return (false, "Snapshot not found");
        }

        uint256 blocksPassed = block.number - snapshot.blockNumber;
        if (blocksPassed < LOOKBACK_DISTANCE) {
            return (false, "Lookback distance not met");
        }

        uint256 snapshotParentBlock = snapshot.blockNumber - 1;
        if (block.number - snapshotParentBlock > MAX_BLOCKHASH_AGE) {
            return (false, "Blockhash too old to verify");
        }

        bytes32 currentHashOfSnapshotParent = blockhash(snapshotParentBlock);
        if (currentHashOfSnapshotParent != snapshot.blockHash) {
            return (false, "Reorg detected - ancestry mismatch");
        }

        return (true, "");
    }

    // ============================================================
    //                    UTILITY FUNCTIONS
    // ============================================================

    /**
     * @notice Returns the number of blocks until lookback distance is met
     * @param settlementId The settlement ID to check
     * @return blocks Number of blocks remaining (0 if already met)
     */
    function blocksUntilCheckpoint(bytes32 settlementId) public view returns (uint256 blocks) {
        ChainSnapshot memory snapshot = chainSnapshots[settlementId];
        
        if (!snapshot.exists) {
            return LOOKBACK_DISTANCE;
        }

        uint256 targetBlock = snapshot.blockNumber + LOOKBACK_DISTANCE;
        if (block.number >= targetBlock) {
            return 0;
        }
        
        return targetBlock - block.number;
    }

    /**
     * @notice Checks if a settlement is safe to finalize
     * @param settlementId The settlement ID to check
     * @return True if lookback distance met and ancestry verified
     */
    function isSafeToFinalize(bytes32 settlementId) public view returns (bool) {
        (bool canVerify, ) = canVerifyAncestry(settlementId);
        return canVerify;
    }
}
