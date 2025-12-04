// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IClearSettle.sol";
import "../libraries/SafetyGadget.sol";

/**
 * @title SafetyEngineImpl
 * @author ClearSettle Team - TriHacker Tournament Finale Module 5
 * @notice Reorg-safe settlement engine with idempotence protection
 * @dev Implements ISafetyEngine interface for reorg-resistant settlement
 *
 * ARCHITECTURE:
 * =============
 * - Maintains settled batches with finality status
 * - Tracks nullifiers to prevent double-settlement
 * - Enforces lookback distance for shallow reorg safety
 * - Verifies ancestry to detect deep reorg forks
 *
 * FINALITY PROGRESSION:
 * 1. PENDING → LOGGED (batch included in L1)
 * 2. LOGGED → CHECKPOINTED (after LOOKBACK_DISTANCE blocks)
 * 3. CHECKPOINTED → immutable (can never revert)
 *
 * IDEMPOTENCE:
 * - Each transaction has unique nullifier N(Tx) = keccak256(sender || nonce || payload)
 * - Nullifier tracked in consumedNullifiers map
 * - Prevents transaction from settling twice even after reorg
 */
contract SafetyEngineImpl is ISafetyEngine {
    using SafetyGadget for *;

    // ============ Storage ============

    /// @notice Mapping of batch ID to settlement batch
    mapping(uint256 => SettlementBatch) public settlements;

    /// @notice Mapping of nullifier to batch ID (for idempotence tracking)
    mapping(bytes32 => uint256) public consumedNullifiers;

    /// @notice Mapping of batch ID to finality status (redundant with settlements[].status)
    mapping(uint256 => FinalityStatus) public batchStatuses;

    /// @notice ID of last finalized (CHECKPOINTED) batch
    uint256 public lastFinalizedBatchId;

    /// @notice Hash of last finalized batch (for ancestry checks)
    bytes32 public lastFinalizedHash;

    /// @notice Total number of batches processed
    uint256 public batchCount;

    /// @notice Current batch being accumulated
    uint256 public currentBatchId;

    // ============ Constructor ============

    constructor() {
        lastFinalizedBatchId = 0;
        lastFinalizedHash = bytes32(0);
        batchCount = 0;
        currentBatchId = 0;
    }

    // ============ Core Functions ============

    /**
     * @notice Log batch on L1 (transitions to LOGGED status)
     * @param batchId Batch identifier
     * @param stateRoot Hash of batch state
     * @return success True if logged successfully
     *
     * LOGIC:
     * 1. Batch must exist and be PENDING
     * 2. Update status to LOGGED
     * 3. Record L1 block number for lookback tracking
     * 4. Emit event
     */
    function logBatch(uint256 batchId, bytes32 stateRoot)
        external
        override
        returns (bool success)
    {
        SettlementBatch storage batch = settlements[batchId];

        // Batch must exist and be PENDING
        require(batch.batchId == batchId, "SafetyEngineImpl: Batch does not exist");
        require(batch.status == FinalityStatus.PENDING, "SafetyEngineImpl: Batch not pending");

        // Transition to LOGGED status
        batch.status = FinalityStatus.LOGGED;
        batchStatuses[batchId] = FinalityStatus.LOGGED;

        // Record L1 block number (for lookback calculation)
        batch.l1BlockNumber = block.number;

        emit BatchLogged(batchId, stateRoot, block.number);
        return true;
    }

    /**
     * @notice Finalize batch after LOOKBACK_DISTANCE blocks (transitions to CHECKPOINTED)
     * @param batchId Batch to finalize
     * @param parentHash Hash of previous finalized batch (ancestry check)
     *
     * WORKFLOW:
     * 1. Verify batch is LOGGED
     * 2. Verify batch is sufficiently old (LOOKBACK_DISTANCE)
     * 3. Verify ancestry (parent hash matches last finalized)
     * 4. Verify idempotence (no nullifier replays)
     * 5. Mark all nullifiers as consumed
     * 6. Update lastFinalizedBatchId and lastFinalizedHash
     * 7. Transition status to CHECKPOINTED
     *
     * CRITICAL: Once CHECKPOINTED, batch can never revert (immutable settlement)
     */
    function finalizeBatch(uint256 batchId, bytes32 parentHash) external override {
        SettlementBatch storage batch = settlements[batchId];

        // 1. Batch must exist and be LOGGED
        require(batch.batchId == batchId, "SafetyEngineImpl: Batch does not exist");
        require(batch.status == FinalityStatus.LOGGED, "SafetyEngineImpl: Batch not logged");

        // 2. Verify displacement check (batch old enough)
        uint256 ageInBlocks = block.number - batch.l1BlockNumber;
        require(
            ageInBlocks >= SafetyGadget.LOOKBACK_DISTANCE,
            "SafetyEngineImpl: Batch not chemically stable (age < LOOKBACK_DISTANCE)"
        );

        // 3. Verify ancestry check (parent matches last finalized)
        require(
            parentHash == lastFinalizedHash,
            "SafetyEngineImpl: Fork detected - parent hash mismatch"
        );

        // 4. Verify idempotence (no nullifier replays)
        for (uint256 i = 0; i < batch.transactionNullifiers.length; i++) {
            bytes32 nullifier = batch.transactionNullifiers[i];
            uint256 previousBatchId = consumedNullifiers[nullifier];

            // If nullifier was consumed before
            if (previousBatchId != 0) {
                FinalityStatus previousStatus = batchStatuses[previousBatchId];

                // If previous batch is CHECKPOINTED: replay attack
                if (previousStatus == FinalityStatus.CHECKPOINTED) {
                    revert("SafetyEngineImpl: Double-settlement detected - nullifier already consumed");
                }
                // Otherwise: shallow reorg orphaned previous batch, allow reclaim
            }
        }

        // 5. Mark all nullifiers as consumed
        for (uint256 i = 0; i < batch.transactionNullifiers.length; i++) {
            consumedNullifiers[batch.transactionNullifiers[i]] = batchId;
        }

        // 6. Update last finalized tracking
        lastFinalizedBatchId = batchId;
        lastFinalizedHash = batch.stateRoot;

        // 7. Transition status to CHECKPOINTED (immutable)
        batch.status = FinalityStatus.CHECKPOINTED;
        batchStatuses[batchId] = FinalityStatus.CHECKPOINTED;

        emit BatchCheckpointed(batchId, block.number);
    }

    /**
     * @notice Verify transactions have no replays (idempotence check)
     * @param batchId Batch being verified
     * @param nullifiers Array of transaction nullifiers
     * @return isIdempotent True if no double-spending detected
     *
     * LOGIC:
     * - For each nullifier:
     *   - If not consumed: OK
     *   - If consumed by CHECKPOINTED batch: replay attack
     *   - If consumed by non-CHECKPOINTED batch: shallow reorg, allow reclaim
     */
    function verifyIdempotence(uint256 batchId, bytes32[] calldata nullifiers)
        external
        view
        override
        returns (bool isIdempotent)
    {
        for (uint256 i = 0; i < nullifiers.length; i++) {
            bytes32 nullifier = nullifiers[i];
            uint256 previousBatchId = consumedNullifiers[nullifier];

            // If nullifier was consumed before
            if (previousBatchId != 0) {
                FinalityStatus previousStatus = batchStatuses[previousBatchId];

                // If previous batch is CHECKPOINTED: this is a replay attack
                if (previousStatus == FinalityStatus.CHECKPOINTED) {
                    return false; // Idempotence violated
                }
                // Otherwise: previous batch orphaned, allow reclaim
            }
        }

        return true; // No idempotence violations
    }

    /**
     * @notice Detect deep reorg by checking old blockhash
     * @param expectedHeight Block height of stored chain tip
     * @param expectedHash Hash of stored chain tip
     * @return hasReorged True if deep reorg detected
     *
     * MECHANISM:
     * - Check if blockhash(expectedHeight) == expectedHash
     * - If blockhash changed: deep reorg occurred
     * - If blockhash too old: assume no reorg (EVM can only check recent 256 blocks)
     */
    function detectDeepReorg(uint256 expectedHeight, bytes32 expectedHash)
        external
        view
        override
        returns (bool hasReorged)
    {
        return SafetyGadget.detectDeepReorg(expectedHeight, expectedHash);
    }

    /**
     * @notice Reclaim nullifier after shallow reorg orphaned previous batch
     * @param nullifier Transaction nullifier to reclaim
     * @param previousBatchId ID of batch that was orphaned
     *
     * LOGIC:
     * - Previous batch must NOT be CHECKPOINTED (otherwise immutable)
     * - Shallow reorg orphaned the batch, so nullifier can be reused
     * - Remove nullifier from consumedNullifiers map
     *
     * SECURITY:
     * - Only works for non-finalized batches
     * - Cannot reclaim if previous batch is CHECKPOINTED
     */
    function reclaimNullifier(bytes32 nullifier, uint256 previousBatchId) external override {
        FinalityStatus previousStatus = batchStatuses[previousBatchId];

        // Can only reclaim if previous batch NOT finalized
        require(
            previousStatus != FinalityStatus.CHECKPOINTED,
            "SafetyEngineImpl: Cannot reclaim - previous batch immutable"
        );

        // Reclaim: clear from consumed mapping
        delete consumedNullifiers[nullifier];

        emit NullifierReclaimed(nullifier, previousBatchId);
    }

    // ============ Batch Management ============

    /**
     * @notice Create new batch for settlement
     * @param nullifiers Array of transaction nullifiers in batch
     * @return batchId ID of new batch
     */
    function createBatch(bytes32[] memory nullifiers) external returns (uint256 batchId) {
        batchId = batchCount++;
        currentBatchId = batchId;

        // Initialize batch as PENDING
        SettlementBatch storage batch = settlements[batchId];
        batch.batchId = batchId;
        // Store nullifiers
        for (uint256 i = 0; i < nullifiers.length; i++) {
            batch.transactionNullifiers.push(nullifiers[i]);
        }
        batch.status = FinalityStatus.PENDING;
        batch.stateRoot = SafetyGadget.calculateBatchStateRoot(batchId, nullifiers);
        batchStatuses[batchId] = FinalityStatus.PENDING;

        return batchId;
    }

    // ============ View Functions ============

    /**
     * @notice Check if batch is finalized (immutable)
     * @param batchId Batch to check
     * @return isCheckpointed True if batch status is CHECKPOINTED
     */
    function isBatchFinalized(uint256 batchId) external view override returns (bool isCheckpointed) {
        return batchStatuses[batchId] == FinalityStatus.CHECKPOINTED;
    }

    /**
     * @notice Get finality status of batch
     * @param batchId Batch identifier
     * @return status Current FinalityStatus
     */
    function getBatchStatus(uint256 batchId) external view override returns (FinalityStatus status) {
        return batchStatuses[batchId];
    }

    /**
     * @notice Get nullifier consumption status
     * @param nullifier Transaction nullifier
     * @return consumedInBatch Batch ID where consumed, or 0 if not consumed
     */
    function getNullifierStatus(bytes32 nullifier) external view override returns (uint256 consumedInBatch) {
        return consumedNullifiers[nullifier];
    }

    /**
     * @notice Get highest finalized batch
     * @return batchId ID of last finalized batch
     * @return hash Hash of finalized batch
     */
    function getLastFinalizedBatch() external view override returns (uint256 batchId, bytes32 hash) {
        return (lastFinalizedBatchId, lastFinalizedHash);
    }

    /**
     * @notice Get full batch details
     * @param batchId Batch identifier
     * @return batch Complete batch data
     */
    function getBatch(uint256 batchId) external view returns (SettlementBatch memory batch) {
        return settlements[batchId];
    }

    /**
     * @notice Check if lookback distance has passed for batch
     * @param batchId Batch to check
     * @return hasPassed True if batch is old enough to finalize
     */
    function hasLookbackPassed(uint256 batchId) external view returns (bool hasPassed) {
        SettlementBatch storage batch = settlements[batchId];
        if (batch.l1BlockNumber == 0) return false; // Not logged yet

        uint256 ageInBlocks = block.number - batch.l1BlockNumber;
        return ageInBlocks >= SafetyGadget.LOOKBACK_DISTANCE;
    }

    /**
     * @notice Get age of batch in blocks
     * @param batchId Batch identifier
     * @return ageInBlocks Blocks since L1 inclusion
     */
    function getBatchAge(uint256 batchId) external view returns (uint256 ageInBlocks) {
        SettlementBatch storage batch = settlements[batchId];
        if (batch.l1BlockNumber == 0) return 0;

        return block.number - batch.l1BlockNumber;
    }
}
