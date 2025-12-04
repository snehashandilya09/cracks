// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IClearSettle
 * @author ClearSettle Team - TriHacker Tournament Finale
 * @notice Core interfaces for the ClearSettle Epoch-Based Batch Auction Protocol
 * @dev Implements fair ordering through commit-reveal with batch settlement
 * 
 * ARCHITECTURE OVERVIEW:
 * =====================
 * ClearSettle is an adversarial-resilient settlement protocol that processes
 * trades through epoch-based batch auctions. Each epoch has 5 phases:
 * 
 * 1. ACCEPTING_COMMITS  - Users submit hashed orders (blind bids)
 * 2. ACCEPTING_REVEALS  - Users reveal their orders with salt
 * 3. SETTLING          - Contract calculates uniform clearing price
 * 4. SAFETY_BUFFER     - Wait period for reorg protection (partial finality)
 * 5. FINALIZED         - Users can withdraw settled funds
 * 
 * KEY SECURITY PROPERTIES:
 * - Fair Ordering: Settlement independent of validator ordering (batch execution)
 * - Invariant Enforcement: 5 core invariants verified on every state change
 * - Partial Finality: Multi-block settlement with safety buffer
 * - Oracle Defense: Optimistic assertions with dispute mechanism
 */

/**
 * @notice Epoch lifecycle phases
 * @dev Each epoch progresses through these phases sequentially
 * Transitions are time-bound (block-based) and cannot be skipped
 *
 * AFSM STATES (per Module-1 Section 2.1):
 * - Idle → UNINITIALIZED
 * - Batching → ACCEPTING_COMMITS / ACCEPTING_REVEALS
 * - PreCommitted → SETTLING
 * - InTransition → IN_TRANSITION (VeriSolid augmentation)
 * - Dispute → VOID (or separate DISPUTE state for oracle challenges)
 * - Finalized → FINALIZED
 */
enum EpochPhase {
    UNINITIALIZED,      // 0: Default state, epoch not started (Idle)
    ACCEPTING_COMMITS,  // 1: Users submit commitment hashes (Batching)
    ACCEPTING_REVEALS,  // 2: Users reveal orders with salt (Batching)
    SETTLING,           // 3: Batch settlement calculation (PreCommitted)
    IN_TRANSITION,      // 4: CRITICAL - Locking state for reentrancy protection (InTransition)
    SAFETY_BUFFER,      // 5: Reorg protection period (partial finality)
    FINALIZED,          // 6: Settlement complete, withdrawals enabled (Finalized)
    VOID                // 7: Emergency state - epoch invalidated (invariant violation)
}

/**
 * @notice Order direction for batch auction
 */
enum OrderSide {
    BUY,   // User wants to buy the settlement asset
    SELL   // User wants to sell the settlement asset
}

/**
 * @notice Commitment structure stored during commit phase
 * @dev Only hash is stored on-chain to prevent front-running
 * 
 * STORAGE OPTIMIZATION:
 * - Using bytes32 for hash (32 bytes)
 * - Using uint40 for timestamp (5 bytes, good until year 36812)
 * - Using uint96 for bond (12 bytes, max ~79 billion ETH)
 * - Packed into single slot where possible
 */
struct Commitment {
    bytes32 hash;           // keccak256(amount, side, salt, sender)
    uint40 commitBlock;     // Block when commitment was made
    uint96 bondAmount;      // ETH bond posted (anti-griefing)
    bool revealed;          // Whether order has been revealed
    bool slashed;           // Whether bond was slashed (no-reveal penalty)
}

/**
 * @notice Revealed order ready for batch settlement
 */
struct RevealedOrder {
    address trader;         // Order owner
    uint256 amount;         // Amount to trade
    OrderSide side;         // BUY or SELL
    uint256 limitPrice;     // Maximum price for BUY, minimum for SELL
    bool executed;          // Whether order was filled in settlement
}

/**
 * @notice Epoch metadata and state
 */
struct EpochData {
    uint256 epochId;                // Sequential epoch identifier
    EpochPhase phase;               // Current phase
    uint256 startBlock;             // Block when epoch started
    uint256 commitEndBlock;         // Last block for commits
    uint256 revealEndBlock;         // Last block for reveals
    uint256 settleBlock;            // Block when settlement occurred
    uint256 safetyEndBlock;         // Block when safety buffer ends
    uint256 clearingPrice;          // Uniform clearing price (set during SETTLING)
    uint256 totalBuyVolume;         // Total buy orders (revealed)
    uint256 totalSellVolume;        // Total sell orders (revealed)
    uint256 matchedVolume;          // Volume that was matched
    bool disputed;                  // Whether settlement is under dispute
}

/**
 * @notice Settlement result for a specific user in an epoch
 */
struct SettlementResult {
    uint256 tokensReceived;         // Tokens user receives
    uint256 tokensPaid;             // Tokens user paid
    uint256 bondReturned;           // Bond amount returned
    bool claimed;                   // Whether user claimed their settlement
}

/**
 * @notice Oracle assertion for disputed settlements
 * @dev Used in optimistic oracle defense mechanism
 *
 * TODO: For production, integrate with Chainlink or UMA oracle
 * Currently uses internal assertion/dispute for hackathon demo
 */
struct OracleAssertion {
    address asserter;               // Who made the assertion
    bytes32 assertionHash;          // Hash of asserted data
    uint256 bond;                   // Bond posted by asserter
    uint256 assertionBlock;         // When assertion was made
    uint256 disputeDeadline;        // Last block to dispute
    bool disputed;                  // Whether challenged
    bool resolved;                  // Whether finalized
    bool truthful;                  // Outcome (if resolved)
}

// ============ MODULE 2: FAIR ORDERING & MEV RESISTANCE ============

/**
 * @notice Validator timestamp for reception log (Aequitas Stage I)
 * @dev Used to track when each validator received a transaction
 */
struct ValidatorTimestamp {
    address validator;              // Validator address
    uint256 timestamp;              // When they received the tx (block number)
}

/**
 * @notice Reception log entry for a transaction
 * @dev Stores all validator timestamps for ordering fairness
 */
struct ReceptionLog {
    bytes32 txHash;                 // Transaction hash
    ValidatorTimestamp[] timestamps;// Timestamps from all validators
    bool finalized;                 // Whether ordering is finalized
}

/**
 * @notice Dependency graph edge for fair ordering
 * @dev Used in Aequitas algorithm (Stage II)
 */
struct DependencyEdge {
    bytes32 fromTx;                 // Source transaction
    bytes32 toTx;                   // Target transaction
    uint256 supportCount;           // Number of validators who saw fromTx first
    bool enforced;                  // Whether edge is above fairness threshold
}

/**
 * @notice Strongly Connected Component (SCC) - Atomic Batch
 * @dev Transactions in same SCC are "simultaneous" (partial finality)
 */
struct AtomicBatch {
    bytes32[] transactions;         // List of tx hashes in this SCC
    uint256 batchIndex;             // Order in final sequence
    bool executed;                  // Whether batch has been executed
}

/**
 * @notice Counterfactual benchmark for FCA fairness
 * @dev Stores oracle price and expected value per user
 */
struct CounterfactualBenchmark {
    uint256 oraclePrice;            // Median oracle price for reference
    address user;                   // User being benchmarked
    uint256 expectedTokens;         // Tokens they'd get trading alone at oracle price
    uint256 expectedCost;           // Cost they'd pay at oracle price
}

/**
 * @title IClearSettleCore
 * @notice Main interface for ClearSettle protocol interactions
 */
interface IClearSettleCore {
    // ============ Events ============
    
    /// @notice Emitted when a new epoch starts
    event EpochStarted(uint256 indexed epochId, uint256 startBlock, uint256 commitEndBlock);
    
    /// @notice Emitted when user commits to an order
    event OrderCommitted(uint256 indexed epochId, address indexed trader, bytes32 commitmentHash);
    
    /// @notice Emitted when user reveals their order
    event OrderRevealed(uint256 indexed epochId, address indexed trader, uint256 amount, OrderSide side);
    
    /// @notice Emitted when epoch settles
    event EpochSettled(uint256 indexed epochId, uint256 clearingPrice, uint256 matchedVolume);
    
    /// @notice Emitted when user claims settlement
    event SettlementClaimed(uint256 indexed epochId, address indexed trader, uint256 tokensReceived);
    
    /// @notice Emitted when bond is slashed (no-reveal)
    event BondSlashed(uint256 indexed epochId, address indexed trader, uint256 amount);
    
    /// @notice Emitted when settlement is disputed
    event SettlementDisputed(uint256 indexed epochId, address indexed disputer);
    
    /// @notice Emitted when invariant is checked
    event InvariantChecked(string invariantName, bool passed);
    
    /// @notice Emitted on emergency void
    event EpochVoided(uint256 indexed epochId, string reason);

    // ============ Core Functions ============
    
    /**
     * @notice Commit to an order (Phase 1)
     * @param commitmentHash keccak256(amount, side, salt, msg.sender)
     * @dev Requires ETH bond to prevent griefing
     * 
     * SECURITY: Hash hides order details from validators/MEV searchers
     * until reveal phase, ensuring fair ordering
     */
    function commitOrder(bytes32 commitmentHash) external payable;
    
    /**
     * @notice Reveal a committed order (Phase 2)
     * @param amount Order amount
     * @param side BUY or SELL
     * @param limitPrice Price limit
     * @param salt Random value used in commitment
     * @dev Must match previously committed hash
     * 
     * SECURITY: Verifies hash matches, adds to batch for settlement
     * Bond returned on successful reveal
     */
    function revealOrder(
        uint256 amount,
        OrderSide side,
        uint256 limitPrice,
        bytes32 salt
    ) external;
    
    /**
     * @notice Trigger epoch settlement (Phase 3)
     * @dev Can be called by anyone after reveal phase ends
     * Calculates uniform clearing price and matches orders
     * 
     * INVARIANTS CHECKED:
     * 1. Conservation of Value
     * 2. Solvency
     * 3. Single Execution (idempotency)
     */
    function settleEpoch() external;
    
    /**
     * @notice Claim settlement results (Phase 5)
     * @param epochId Epoch to claim from
     * @dev Only available after safety buffer period
     * 
     * SECURITY: Safety buffer prevents reorg-snipe attacks
     */
    function claimSettlement(uint256 epochId) external;
    
    /**
     * @notice Force transition to next epoch (Liveness guarantee)
     * @dev Can be called if current epoch is stuck
     * Implements escape hatch for locked funds
     */
    function forceAdvanceEpoch() external;

    // ============ View Functions ============
    
    function getCurrentEpoch() external view returns (uint256);
    function getEpochData(uint256 epochId) external view returns (EpochData memory);
    function getCommitment(uint256 epochId, address trader) external view returns (Commitment memory);
    function getSettlementResult(uint256 epochId, address trader) external view returns (SettlementResult memory);
    function getCurrentPhase() external view returns (EpochPhase);
}

/**
 * @title IClearSettleOracle
 * @notice Interface for oracle defense mechanism
 * @dev Handles disputed settlements through optimistic assertions
 * 
 * TODO: For production deployment:
 * - Integrate with Chainlink Data Feeds for price verification
 * - Consider UMA Optimistic Oracle for complex disputes
 * - Add TWAP checks for manipulation resistance
 */
interface IClearSettleOracle {
    /**
     * @notice Assert a settlement result
     * @param epochId Epoch being asserted
     * @param clearingPrice Asserted clearing price
     * @param matchedVolume Asserted matched volume
     * @dev Requires bond, opens dispute window
     */
    function assertSettlement(
        uint256 epochId,
        uint256 clearingPrice,
        uint256 matchedVolume
    ) external payable;
    
    /**
     * @notice Dispute an assertion
     * @param epochId Epoch being disputed
     * @param evidence Supporting data for dispute
     * @dev Requires matching bond, triggers resolution
     */
    function disputeSettlement(
        uint256 epochId,
        bytes calldata evidence
    ) external payable;
    
    /**
     * @notice Resolve a dispute
     * @param epochId Epoch to resolve
     * @dev Called after dispute window or by arbiter
     */
    function resolveDispute(uint256 epochId) external;
}

/**
 * @title IClearSettleSafety
 * @notice Interface for invariant enforcement
 * @dev All invariants must pass for state transitions
 */
interface IClearSettleSafety {
    /**
     * @notice Check all protocol invariants
     * @return allPassed True if all invariants hold
     * @return failedInvariant Name of first failed invariant (empty if all pass)
     */
    function checkAllInvariants() external view returns (bool allPassed, string memory failedInvariant);

    /**
     * @notice Trigger emergency shutdown if invariant violated
     * @param reason Description of violation
     */
    function emergencyVoid(string calldata reason) external;
}

/**
 * @notice Module-3: Checkpoint for finality gadget
 * @dev Represents a position in the finalized chain
 */
struct Checkpoint {
    bytes32 chainRoot;              // Block being voted on
    uint256 height;                 // Checkpoint height (block_number / checkpoint_interval)
    uint256 epoch;                  // Current view/round number
}

/**
 * @notice Module-3: Vote for checkpoint (Casper FFG style)
 * @dev Contains both source (previous justified) and target (proposed) checkpoint
 */
struct Vote {
    address validator;              // Validator identity
    Checkpoint source;              // Last justified checkpoint validator has seen
    Checkpoint target;              // Proposed checkpoint being voted for
    bytes signature;                // ECDSA signature over vote
}

/**
 * @notice Module-3: Global protocol state for finality gadget
 * @dev Tracks available chain, justified checkpoints, and finalized checkpoints
 */
struct FinalizationState {
    bytes32 availableChainHead;     // chAva: Head of available chain (liveness)
    Checkpoint justifiedCheckpoint; // chJust: Highest justified checkpoint (partial finality)
    Checkpoint finalizedCheckpoint; // chFin: Highest finalized checkpoint (settlement)
    uint256 totalValidatorStake;    // Total stake of all validators
    uint256 currentEpoch;           // Current view/round number
}

/**
 * @title ISettlementGadget
 * @notice Finality gadget implementing Casper FFG + GRANDPA concepts
 * @dev Module-3: Partial Finality & Liveness Protocol
 */
interface ISettlementGadget {
    // ============ Events ============

    /// @notice Emitted when checkpoint is justified (Partial Finality)
    event CheckpointJustified(Checkpoint indexed checkpoint, uint256 totalVotingWeight);

    /// @notice Emitted when checkpoint is finalized (Settlement Complete)
    event CheckpointFinalized(Checkpoint indexed checkpoint, bytes32 chainRoot);

    /// @notice Emitted when validator equivocates (double vote)
    event ValidatorSlashed(address indexed validator, string reason);

    /// @notice Emitted when surround vote is detected
    event SurroundVoteDetected(address indexed validator, Checkpoint vote1Source, Checkpoint vote1Target, Checkpoint vote2Source, Checkpoint vote2Target);

    // ============ Core Functions ============

    /**
     * @notice Submit a vote for a checkpoint
     * @param vote Vote containing source, target, validator, and signature
     * @dev Validates signature and checks for slashing conditions
     */
    function submitVote(Vote calldata vote) external;

    /**
     * @notice Process votes and update justification/finalization state
     * @param votes Array of votes to process
     * @dev Updates justified and finalized checkpoints based on 2/3+ consensus
     */
    function processVotes(Vote[] calldata votes) external;

    /**
     * @notice Submit evidence of a slashing violation
     * @param vote1 First vote by validator
     * @param vote2 Second vote by same validator
     * @dev Detects double votes or surround votes; triggers slashing
     */
    function submitSlashingEvidence(Vote calldata vote1, Vote calldata vote2) external;

    /**
     * @notice Get the current finalization state
     * @return state The global finalization state
     */
    function getFinalizationState() external view returns (FinalizationState memory);

    /**
     * @notice Check if a checkpoint is justified
     * @param checkpoint Checkpoint to check
     * @return isJustified True if checkpoint has > 2/3 votes
     */
    function isCheckpointJustified(Checkpoint calldata checkpoint) external view returns (bool);

    /**
     * @notice Check if a checkpoint is finalized
     * @param checkpoint Checkpoint to check
     * @return isFinalized True if checkpoint is finalized
     */
    function isCheckpointFinalized(Checkpoint calldata checkpoint) external view returns (bool);

    /**
     * @notice Recover from network partition (liveness)
     * @dev Allows finalization of highest justified ancestor when < 2/3 votes available
     */
    function recoverFromPartition() external;
}

// ============ MODULE-4: ORACLE MANIPULATION RESISTANCE & DISPUTE RESOLUTION ============

/**
 * @title IOracleGadget
 * @notice Oracle-based price feed with dispute resolution
 * @dev Implements Optimistic Oracle Settlement Engine (OOSE) with:
 *      - DECO protocol for data provenance (TLS authenticity)
 *      - Specular dispute resolution (bisection game + one-step proofs)
 *      - Economic security (escrow bonds + commit-reveal)
 */
interface IOracleGadget {
    /**
     * @notice Submit oracle price with cryptographic proof
     * @param oraclePrice The submitted price (in ETH per token)
     * @param proof DECO proof of data authenticity from TLS session
     * @param proverBond Bond posted by prover (in ETH)
     */
    function submitOraclePrice(
        uint256 oraclePrice,
        bytes calldata proof,
        uint256 proverBond
    ) external payable;

    /**
     * @notice Challenge submitted oracle price
     * @param oraclePriceId Identifier of price submission to challenge
     * @param salt Random value for commit-reveal scheme
     */
    function commitChallenge(
        uint256 oraclePriceId,
        bytes32 salt
    ) external payable;

    /**
     * @notice Reveal challenge decision and evidence
     * @param oraclePriceId Identifier of price to challenge
     * @param decision True if claiming price is invalid, false if valid
     * @param salt Salt used in commit phase
     * @param evidence Bisection proof demonstrating invalid execution
     */
    function revealChallenge(
        uint256 oraclePriceId,
        bool decision,
        bytes32 salt,
        bytes calldata evidence
    ) external;

    /**
     * @notice Get current oracle price (after dispute resolution window)
     * @return price The confirmed price in ETH per token
     * @return isResolved Whether price is confirmed (dispute window closed)
     */
    function getConfirmedPrice() external view returns (uint256 price, bool isResolved);
}

/**
 * @notice Oracle price submission with cryptographic proof
 */
struct OraclePriceSubmission {
    uint256 oraclePriceId;          // Sequential submission identifier
    uint256 price;                  // Price in ETH per token
    address prover;                 // Validator/oracle node that submitted price
    uint256 proverBond;             // Bond posted by prover (in ETH)
    uint256 submitBlock;            // Block when price was submitted
    bytes proverProof;              // DECO proof of TLS authenticity
    OraclePriceStatus status;       // Current status (Pending, Confirmed, Disputed)
    uint256 challengeCount;         // Number of challenges
}

/**
 * @notice Status of oracle price submission
 */
enum OraclePriceStatus {
    PENDING,        // 0: Awaiting dispute window
    CONFIRMED,      // 1: Survived dispute window, price locked
    DISPUTED,       // 2: Under active dispute
    INVALID,        // 3: Dispute resolved, price invalid
    RESOLVED        // 4: Dispute resolved, prover invalid
}

/**
 * @notice Challenge to oracle price (commit phase)
 */
struct ChallengeCommit {
    address challenger;             // Wallet address of challenger
    bytes32 commitHash;             // H(decision || salt || challenger)
    uint256 challengeBond;          // Bond posted by challenger (in ETH)
    uint256 commitBlock;            // Block when challenge was committed
    bool revealed;                  // Whether reveal has occurred
}

/**
 * @notice Revealed challenge with evidence
 */
struct ChallengeReveal {
    bool decision;                  // True if claiming price invalid, false if valid
    bytes evidence;                 // Bisection proof or one-step proof
    bytes32 salt;                   // Random salt from commit phase
    uint256 revealBlock;            // Block when challenge was revealed
    BisectionOutcome outcome;       // Result of dispute resolution
}

/**
 * @notice Bisection game state for dispute resolution
 */
struct DisputeGame {
    uint256 gameId;                 // Unique game identifier
    uint256 oraclePriceId;          // Price submission being disputed
    address prover;                 // Original price submitter
    address challenger;             // Challenge initiator
    uint256 traceLength;            // Total number of execution steps
    uint256 leftPointer;            // Current bisection left boundary
    uint256 rightPointer;           // Current bisection right boundary
    uint256 round;                  // Current bisection round
    DisputeGameStatus status;       // Game state
    address winner;                 // Winner after game resolution
}

/**
 * @notice Status of dispute game
 */
enum DisputeGameStatus {
    ACTIVE,         // 0: Bisection game ongoing
    CONVERGED,      // 1: Bisection has converged to single step
    RESOLVED,       // 2: Winner determined
    TIMEOUT         // 3: Timeout due to inactivity
}

/**
 * @notice Result of bisection game
 */
enum BisectionOutcome {
    PROVER_VALID,   // 0: Price is valid, prover receives reward
    PROVER_INVALID, // 1: Price is invalid, challenger receives reward
    GAME_TIMEOUT    // 2: Game timed out, challenger wins by default
}

/**
 * @notice Escrow vault for bonds during dispute
 */
struct EscrowVault {
    uint256 totalLocked;            // Total value locked in escrow
    uint256 unlockBlock;            // Block when escrow becomes withdrawable
    address beneficiary;            // Address that receives escrow
    bool withdrawn;                 // Whether escrow has been withdrawn
}

/**
 * @notice One-step proof for EVM opcode execution
 */
struct OneStepProof {
    uint256 stepIndex;              // Index of step in execution trace
    bytes32 beforeState;            // EVM state before opcode execution
    bytes32 afterState;             // EVM state after opcode execution
    uint256 gasCost;                // Gas consumed by opcode
    bytes opcode;                   // The opcode being verified
}

// ============ MODULE-5: ATTACK MODEL & REORG SAFETY ENGINE ============

/**
 * @notice Unique identifier for transaction idempotence
 * @dev Nullifier = keccak256(Sender || Nonce || PayloadHash)
 * CRITICAL: Does NOT include BlockNumber, so survives reorgs
 */
type Nullifier is bytes32;

/**
 * @notice Finality status for settlement batches
 * @dev Three shades of finality:
 *      - PENDING: Just submitted, vulnerable to shallow reorgs
 *      - LOGGED: Included in L1, but still within reorg window
 *      - CHECKPOINTED: After LOOKBACK_DISTANCE, immutable
 */
enum FinalityStatus {
    PENDING,        // 0: In mempool, not yet in block
    LOGGED,         // 1: Included in L1, vulnerable to shallow reorg
    CHECKPOINTED    // 2: Passed LOOKBACK_DISTANCE, immutable (state finality)
}

/**
 * @notice Settlement batch for reorg-safe settlement
 * @dev Contains array of nullifiers to track idempotence
 * Each batch is atomic: all transactions finalize together or none
 */
struct SettlementBatch {
    uint256 batchId;                // Sequential batch identifier
    bytes32 stateRoot;              // Hash of batch state (for ordering verification)
    bytes32[] transactionNullifiers; // Array of transaction nullifiers
    uint256 l1BlockNumber;          // Block where batch was included on L1
    FinalityStatus status;          // Current finality status
}

/**
 * @title ISafetyEngine
 * @notice Reorg-safe settlement and idempotence enforcement
 * @dev Module-5: Attack Model & Reorg Safety Engine
 *
 * Protects against:
 * 1. Shallow reorgs (≤64 blocks) - Lookback window
 * 2. Double-spending via replays - Nullifier tracking
 * 3. Time-Bandit attacks - Economic security
 * 4. Deep reorg forks - Ancestry verification
 */
interface ISafetyEngine {
    // ============ Events ============

    /// @notice Emitted when batch enters LOGGED status
    event BatchLogged(uint256 indexed batchId, bytes32 stateRoot, uint256 l1BlockNumber);

    /// @notice Emitted when batch becomes CHECKPOINTED (immutable)
    event BatchCheckpointed(uint256 indexed batchId, uint256 finalityBlock);

    /// @notice Emitted when deep reorg detected
    event DeepReorgDetected(uint256 storedHeight, bytes32 storedHash, bytes32 actualHash);

    /// @notice Emitted when double-settlement attempt detected
    event DoubleSettlementAttempt(bytes32 indexed nullifier, uint256 currentBatch, uint256 previousBatch);

    /// @notice Emitted when nullifier reclaimed after orphaned batch
    event NullifierReclaimed(bytes32 indexed nullifier, uint256 batchId);

    // ============ Core Functions ============

    /**
     * @notice Log batch on L1 (first finality shade)
     * @param batchId Batch identifier
     * @param stateRoot Hash of batch state
     * @return success True if logged successfully
     */
    function logBatch(uint256 batchId, bytes32 stateRoot) external returns (bool success);

    /**
     * @notice Finalize batch after LOOKBACK_DISTANCE blocks
     * @param batchId Batch to finalize
     * @param parentHash Hash of previous finalized batch (ancestry check)
     * @dev Requires batch to be at least LOOKBACK_DISTANCE old
     * CRITICAL: Verifies parent ancestry to detect forks
     */
    function finalizeBatch(uint256 batchId, bytes32 parentHash) external;

    /**
     * @notice Verify batch transactions have no replays
     * @param batchId Batch being verified
     * @param nullifiers Array of transaction nullifiers
     * @return isIdempotent True if no double-spending detected
     */
    function verifyIdempotence(uint256 batchId, bytes32[] calldata nullifiers) external view returns (bool isIdempotent);

    /**
     * @notice Detect deep reorg by checking old blockhash
     * @param expectedHeight Block height of stored chain tip
     * @param expectedHash Hash of stored chain tip
     * @return hasReorged True if deep reorg detected
     */
    function detectDeepReorg(uint256 expectedHeight, bytes32 expectedHash) external view returns (bool hasReorged);

    /**
     * @notice Reclaim nullifier after shallow reorg orphaned previous batch
     * @param nullifier Transaction nullifier to reclaim
     * @param previousBatchId ID of batch that was orphaned
     * @dev Only allowed if previous batch is not CHECKPOINTED
     */
    function reclaimNullifier(bytes32 nullifier, uint256 previousBatchId) external;

    // ============ View Functions ============

    /**
     * @notice Check if batch is finalized (immutable)
     * @param batchId Batch to check
     * @return isCheckpointed True if batch status is CHECKPOINTED
     */
    function isBatchFinalized(uint256 batchId) external view returns (bool isCheckpointed);

    /**
     * @notice Get finality status of batch
     * @param batchId Batch identifier
     * @return status Current FinalityStatus
     */
    function getBatchStatus(uint256 batchId) external view returns (FinalityStatus status);

    /**
     * @notice Get nullifier consumption status
     * @param nullifier Transaction nullifier
     * @return consumedInBatch Batch ID where consumed, or 0 if not consumed
     */
    function getNullifierStatus(bytes32 nullifier) external view returns (uint256 consumedInBatch);

    /**
     * @notice Get highest finalized batch
     * @return batchId ID of last finalized batch
     * @return hash Hash of finalized batch
     */
    function getLastFinalizedBatch() external view returns (uint256 batchId, bytes32 hash);
}
