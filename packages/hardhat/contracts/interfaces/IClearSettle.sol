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
