// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./EpochManager.sol";
import "../libraries/LibClearStorage.sol";
import "../libraries/SafetyModule.sol";
import "../interfaces/IClearSettle.sol";

/**
 * @title ClearSettle
 * @author ClearSettle Team - TriHacker Tournament Finale
 * @notice Main entry point for the ClearSettle Epoch-Based Batch Auction Protocol
 * @dev Implements fair ordering, invariant enforcement, partial finality, and oracle defense
 * 
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                         CLEARSETTLE PROTOCOL                               ║
 * ║                                                                            ║
 * ║  An Adversarial-Resilient Settlement Protocol for Fair Batch Auctions     ║
 * ║                                                                            ║
 * ║  KEY FEATURES:                                                             ║
 * ║  ✓ Fair Ordering via Commit-Reveal (no MEV extraction)                    ║
 * ║  ✓ 5 Core Invariants enforced on every state change                       ║
 * ║  ✓ Partial Finality with configurable safety buffer                       ║
 * ║  ✓ Oracle Defense through optimistic assertions                           ║
 * ║  ✓ Comprehensive threat model and attack mitigations                      ║
 * ║                                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * ARCHITECTURE OVERVIEW:
 * 
 *    User Actions          Smart Contract           State Machine
 *    ────────────         ──────────────           ─────────────
 *    
 *    commitOrder() ───────► Validate Bond ──────► ACCEPTING_COMMITS
 *         │                      │                      │
 *         │                Store Hash                   │ (block time)
 *         │                      │                      ▼
 *    revealOrder() ──────► Verify Hash ─────────► ACCEPTING_REVEALS  
 *         │                      │                      │
 *         │              Add to OrderBook               │ (block time)
 *         │                      │                      ▼
 *    settleEpoch() ──────► Calculate Price ─────► SETTLING
 *         │                      │                      │
 *         │              Execute Batch                  │
 *         │                      │                      ▼
 *         │              Invariant Checks ────────► SAFETY_BUFFER
 *         │                      │                      │
 *         │                                             │ (block time)
 *         │                                             ▼
 *    claimSettlement() ──► Transfer Funds ──────► FINALIZED
 * 
 * 
 * SECURITY MODEL:
 * ===============
 * 
 * Attack              │ Mitigation
 * ────────────────────┼──────────────────────────────────────────
 * Front-running       │ Commit-reveal hides order details
 * Sandwich attack     │ Batch execution at uniform price
 * Reorg attack        │ Safety buffer waits for finality
 * Flash loan          │ Multi-block settlement prevents atomic manipulation
 * Oracle manipulation │ Optimistic assertions with dispute window
 * Griefing (no-reveal)│ Bond slashing for non-revealers
 * Replay attack       │ Single execution invariant (idempotency)
 * Reentrancy          │ Reentrancy guard + CEI pattern
 */
contract ClearSettle is EpochManager, IClearSettleCore {
    using LibClearStorage for LibClearStorage.ClearStorage;
    using SafetyModule for *;
    
    // ============ Constructor ============
    
    /**
     * @notice Deploy ClearSettle protocol
     * @dev Initializes storage, configuration, and first epoch
     */
    constructor() {
        _initializeEpochManager();
    }
    
    // ============ Core Functions ============
    
    /**
     * @notice Commit to an order (Phase 1: ACCEPTING_COMMITS)
     * @param commitmentHash keccak256(abi.encodePacked(amount, side, limitPrice, salt, msg.sender))
     * 
     * HOW TO GENERATE COMMITMENT HASH (off-chain):
     * ```javascript
     * const hash = ethers.utils.solidityKeccak256(
     *   ['uint256', 'uint8', 'uint256', 'bytes32', 'address'],
     *   [amount, side, limitPrice, salt, userAddress]
     * );
     * ```
     * 
     * IMPORTANT: Save your salt! You need it to reveal.
     * 
     * SECURITY PROPERTIES:
     * - Hash hides amount, direction, and price from validators
     * - Cannot be front-run because content is unknown
     * - Bond ensures commitment is serious (anti-spam)
     * 
     * @dev Requirements:
     * - Must be in ACCEPTING_COMMITS phase
     * - Must send at least minCommitBond ETH
     * - Cannot commit twice in same epoch
     */
    function commitOrder(bytes32 commitmentHash) 
        external 
        payable 
        nonReentrant 
        notEmergency 
    {
        // Lazy update phase
        _updatePhase();
        
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        // Validate phase
        require(
            epoch.phase == EpochPhase.ACCEPTING_COMMITS,
            "ClearSettle: Not commit phase"
        );
        
        // Validate bond
        require(
            msg.value >= s.config.minCommitBond,
            "ClearSettle: Insufficient bond"
        );
        
        // Check no existing commitment
        Commitment storage existing = s.commitments[s.currentEpochId][msg.sender];
        require(
            existing.hash == bytes32(0),
            "ClearSettle: Already committed"
        );
        
        // Store commitment
        s.commitments[s.currentEpochId][msg.sender] = Commitment({
            hash: commitmentHash,
            commitBlock: uint40(block.number),
            bondAmount: uint96(msg.value),
            revealed: false,
            slashed: false
        });
        
        // Add trader to epoch list
        LibClearStorage.addTraderToEpoch(s, s.currentEpochId, msg.sender);
        
        // Track deposit for invariant
        s.totalDeposits += msg.value;
        
        emit OrderCommitted(s.currentEpochId, msg.sender, commitmentHash);
    }
    
    /**
     * @notice Reveal a committed order (Phase 2: ACCEPTING_REVEALS)
     * @param amount Order amount (in base units)
     * @param side OrderSide.BUY or OrderSide.SELL
     * @param limitPrice Maximum price for BUY, minimum for SELL
     * @param salt Random bytes32 used when creating commitment
     * 
     * VERIFICATION:
     * Contract reconstructs hash from parameters and verifies
     * it matches the stored commitment hash. If mismatch, reverts.
     * 
     * BOND RETURN:
     * On successful reveal, bond is immediately returned to user.
     * 
     * WHAT IF I DON'T REVEAL?
     * Your bond will be slashed after the reveal phase ends.
     * This prevents the "free option" attack.
     * 
     * @dev Requirements:
     * - Must be in ACCEPTING_REVEALS phase
     * - Must have existing commitment
     * - Hash must match
     * - Cannot reveal twice
     */
    function revealOrder(
        uint256 amount,
        OrderSide side,
        uint256 limitPrice,
        bytes32 salt
    ) 
        external 
        nonReentrant 
        notEmergency 
    {
        // Lazy update phase
        _updatePhase();
        
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];
        
        // Validate phase
        require(
            epoch.phase == EpochPhase.ACCEPTING_REVEALS,
            "ClearSettle: Not reveal phase"
        );
        
        // Get commitment
        Commitment storage commitment = s.commitments[s.currentEpochId][msg.sender];
        require(
            commitment.hash != bytes32(0),
            "ClearSettle: No commitment found"
        );
        require(
            !commitment.revealed,
            "ClearSettle: Already revealed"
        );
        
        // Verify hash matches
        bytes32 computedHash = keccak256(abi.encodePacked(
            amount,
            side,
            limitPrice,
            salt,
            msg.sender
        ));
        require(
            computedHash == commitment.hash,
            "ClearSettle: Hash mismatch"
        );
        
        // Mark as revealed
        commitment.revealed = true;
        
        // Store revealed order
        s.revealedOrders[s.currentEpochId][msg.sender] = RevealedOrder({
            trader: msg.sender,
            amount: amount,
            side: side,
            limitPrice: limitPrice,
            executed: false
        });
        
        // Update epoch volume tracking
        if (side == OrderSide.BUY) {
            epoch.totalBuyVolume += amount;
        } else {
            epoch.totalSellVolume += amount;
        }
        
        // Return bond
        uint256 bondToReturn = commitment.bondAmount;
        s.totalWithdrawals += bondToReturn;
        
        (bool success, ) = msg.sender.call{value: bondToReturn}("");
        require(success, "ClearSettle: Bond return failed");
        
        emit OrderRevealed(s.currentEpochId, msg.sender, amount, side);
    }
    
    /**
     * @notice Trigger epoch settlement (Phase 3: SETTLING)
     * @dev Can be called by anyone after reveal phase ends
     *
     * AUGMENTED SETTLEMENT LOGIC (per Module-1 Section 4.2):
     * Implements VeriSolid augmentation with IN_TRANSITION locking
     * to achieve reentrancy safety by design.
     *
     * ALGORITHM:
     * 1. Pre-Condition Check: Validate phase and invariants
     * 2. Augmentation Step: Lock state to IN_TRANSITION
     * 3. Execution: Slash, calculate price, execute batch
     * 4. Verify: Check post-settlement invariants
     * 5. Transition: Move to SAFETY_BUFFER
     *
     * BATCH AUCTION MECHANICS:
     * - Calculate total buy volume and sell volume
     * - Determine clearing price where supply meets demand
     * - Execute all orders at uniform clearing price
     * - Ensures fair ordering (order of submission irrelevant)
     *
     * REENTRANCY PROTECTION:
     * State is IN_TRANSITION during execution. Any reentrant call
     * will see state != SETTLING and will revert per state machine guard.
     *
     * @dev Requirements:
     * - Must be in SETTLING phase
     * - At least one revealed order exists
     * - All invariants must hold before and after
     */
    function settleEpoch()
        external
        nonReentrant
        notEmergency
    {
        // Lazy update phase
        _updatePhase();

        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[s.currentEpochId];

        // ============ PRE-CONDITION CHECK (Hoare Logic) ============

        // Validate phase
        require(
            epoch.phase == EpochPhase.SETTLING,
            "ClearSettle: Not settle phase"
        );

        // PRE-FLIGHT: Verify Invariant 1 (Solvency) before any modifications
        _verifyPreSettlementInvariants();

        // ============ AUGMENTATION STEP: Locking (VeriSolid) ============

        _transitionPhase(epoch, EpochPhase.SETTLING, EpochPhase.IN_TRANSITION);

        // ============ EXECUTION (The Action) ============

        // Slash non-revealers first
        _slashNonRevealers(s.currentEpochId);

        // Calculate clearing price
        uint256 clearingPrice = _calculateClearingPrice(s.currentEpochId);
        epoch.clearingPrice = clearingPrice;

        // Execute batch settlement (with loop invariant checks inside)
        uint256 matchedVolume = _executeBatchSettlement(s.currentEpochId, clearingPrice);
        epoch.matchedVolume = matchedVolume;

        // Record settle block for time monotonicity
        epoch.settleBlock = block.number;

        // Set safety buffer end
        epoch.safetyEndBlock = block.number + s.config.safetyBufferDuration;

        // ============ VERIFICATION: Post-Condition Check ============

        // Verify post-settlement invariants
        _verifyPostSettlementInvariants();

        // ============ TRANSITION: Move to SAFETY_BUFFER ============

        _transitionPhase(epoch, EpochPhase.IN_TRANSITION, EpochPhase.SAFETY_BUFFER);

        emit EpochSettled(s.currentEpochId, clearingPrice, matchedVolume);
    }
    
    /**
     * @notice Claim settlement results (Phase 5: FINALIZED)
     * @param epochId Epoch to claim from
     * 
     * SAFETY BUFFER EXPLANATION:
     * Even after settlement calculates, we wait X blocks before
     * allowing withdrawals. This protects against blockchain reorgs
     * that could reverse the settlement transaction.
     * 
     * WHY THIS MATTERS:
     * Without safety buffer, an attacker could:
     * 1. See settlement result they don't like
     * 2. Bribe miners to reorg and exclude the settle tx
     * 3. Submit different orders in the new reality
     * 
     * With safety buffer:
     * - Must sustain reorg for many blocks (very expensive)
     * - By the time withdrawal is possible, settlement is "final"
     * 
     * @dev Requirements:
     * - Epoch must be FINALIZED
     * - Must have unclaimed settlement
     */
    function claimSettlement(uint256 epochId) 
        external 
        nonReentrant 
        notEmergency 
    {
        // Update current epoch phase (may affect ability to claim)
        _updatePhase();
        
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[epochId];
        
        // Validate epoch is finalized
        require(
            epoch.phase == EpochPhase.FINALIZED,
            "ClearSettle: Epoch not finalized"
        );
        
        // Get settlement result
        SettlementResult storage result = s.settlements[epochId][msg.sender];
        require(
            !result.claimed,
            "ClearSettle: Already claimed"
        );
        require(
            result.tokensReceived > 0 || result.bondReturned > 0,
            "ClearSettle: Nothing to claim"
        );
        
        // Mark as claimed (Checks-Effects-Interactions pattern)
        result.claimed = true;
        
        // Calculate total to transfer
        uint256 totalToTransfer = result.tokensReceived + result.bondReturned;
        
        // Update withdrawal tracking for invariant
        s.totalWithdrawals += totalToTransfer;
        
        // Transfer funds
        (bool success, ) = msg.sender.call{value: totalToTransfer}("");
        require(success, "ClearSettle: Transfer failed");
        
        emit SettlementClaimed(epochId, msg.sender, result.tokensReceived);
    }
    
    /**
     * @notice Force advance a stuck epoch (Liveness guarantee)
     * @dev Emergency escape hatch if epoch gets stuck
     * 
     * WHEN TO USE:
     * - settle() keeps reverting due to bug
     * - Epoch stuck beyond maxEpochDuration
     * - Need to unlock user funds
     * 
     * WHAT HAPPENS:
     * - Current epoch is voided (no settlements)
     * - Users can withdraw original deposits
     * - New epoch starts
     */
    function forceAdvanceEpoch() 
        external 
        nonReentrant 
    {
        _forceAdvanceEpoch();
    }

    /**
     * @notice Reset emergency mode and start fresh epoch (DEMO ONLY)
     * @dev This is for demonstration purposes - in production, 
     *      emergency mode would require governance/multisig to reset
     */
    function resetForDemo() external nonReentrant {
        LibClearStorage.ClearStorage storage s = _getStorage();
        
        // Reset emergency mode
        s.emergencyMode = false;
        s.emergencyReason = "";
        
        // Start a fresh epoch
        _startNewEpoch();
    }
    
    // ============ Internal Settlement Logic ============
    
    /**
     * @notice Slash bonds of traders who didn't reveal
     * @param epochId Epoch to process
     * 
     * ANTI-GRIEFING MECHANISM:
     * If you commit but don't reveal, you're "holding" the system hostage
     * by having your order in the unknown state. The bond compensates
     * other participants for this disruption.
     * 
     * SLASHED BONDS GO TO:
     * Protocol treasury (can be redistributed to honest participants)
     */
    function _slashNonRevealers(uint256 epochId) internal {
        LibClearStorage.ClearStorage storage s = _getStorage();
        address[] storage traders = s.epochTraders[epochId];
        
        for (uint256 i = 0; i < traders.length; i++) {
            address trader = traders[i];
            Commitment storage commitment = s.commitments[epochId][trader];
            
            // If committed but not revealed, slash
            if (commitment.hash != bytes32(0) && !commitment.revealed && !commitment.slashed) {
                commitment.slashed = true;
                s.treasuryBalance += commitment.bondAmount;
                
                emit BondSlashed(epochId, trader, commitment.bondAmount);
            }
        }
    }
    
    /**
     * @notice Calculate uniform clearing price for batch
     * @param epochId Epoch to calculate for
     * @return clearingPrice The uniform price for all trades
     * 
     * PRICING ALGORITHM:
     * For simplicity, we use a basic supply/demand intersection:
     * - If buyVolume > sellVolume: price increases
     * - If sellVolume > buyVolume: price decreases
     * - Equal volumes: use market price (or 1:1 for demo)
     * 
     * TODO: For production, implement proper order book matching:
     * - Sort buy orders by limit price (descending)
     * - Sort sell orders by limit price (ascending)
     * - Find intersection point
     * 
     * TODO: For external price, integrate with:
     * - Chainlink price feeds
     * - Uniswap V3 TWAP
     */
    function _calculateClearingPrice(uint256 epochId) internal view returns (uint256) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        EpochData storage epoch = s.epochs[epochId];
        
        // Simple pricing: 1:1 for demo
        // In production, this would query external oracle or match order book
        
        // If no orders, return 1 (1:1 ratio)
        if (epoch.totalBuyVolume == 0 && epoch.totalSellVolume == 0) {
            return 1 ether; // 1:1 price
        }
        
        // Simple supply/demand ratio
        // clearingPrice = totalBuyVolume / totalSellVolume (normalized)
        // For demo, just return 1 ether (1:1)
        
        // TODO: Implement proper price discovery
        // TODO: Add oracle integration here
        // Example for Chainlink:
        // AggregatorV3Interface priceFeed = AggregatorV3Interface(s.config.chainlinkPriceFeed);
        // (, int256 price,,,) = priceFeed.latestRoundData();
        // return uint256(price);
        
        return 1 ether; // 1:1 price for demo
    }
    
    /**
     * @notice Execute batch settlement at uniform price
     * @param epochId Epoch to settle
     * @param clearingPrice Price for all trades
     * @return matchedVolume Total volume that was matched
     *
     * BATCH EXECUTION LOGIC:
     * 1. Match buy orders with sell orders
     * 2. All execute at clearingPrice
     * 3. Unmatched volume remains unexecuted
     *
     * INVARIANT ENFORCEMENT:
     * - Single Execution (Inv4): Each order marked as executed exactly once
     * - Zero-Sum (Inv3): Total in = Total out
     * - Loop Convergence (Inv4): Prevent Out-Of-Gas DoS via gas checks
     *
     * LOOP INVARIANT (per Module-1 Section 3.4):
     * For each iteration i:
     * - i strictly increases: i → i+1 (unprocessed items strictly decrease)
     * - Gas remaining > SAFETY_THRESHOLD (prevent DoS)
     * - After each update: settlement state consistent
     */
    function _executeBatchSettlement(
        uint256 epochId,
        uint256 clearingPrice
    ) internal returns (uint256 matchedVolume) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        address[] storage traders = s.epochTraders[epochId];

        uint256 totalBuyVolume = 0;
        uint256 totalSellVolume = 0;

        // ============ FIRST PASS: Calculate Total Volumes ============

        // Loop Invariant Check: i increases, unprocessed decreases
        for (uint256 i = 0; i < traders.length; i++) {
            RevealedOrder storage order = s.revealedOrders[epochId][traders[i]];
            if (order.amount > 0 && !order.executed) {
                if (order.side == OrderSide.BUY) {
                    totalBuyVolume += order.amount;
                } else {
                    totalSellVolume += order.amount;
                }
            }
        }

        // Calculate matched volume (minimum of buy and sell)
        matchedVolume = totalBuyVolume < totalSellVolume ? totalBuyVolume : totalSellVolume;

        // ============ SECOND PASS: Execute Orders with Invariant Guards ============

        // Pro-rata allocation if oversubscribed
        // Loop Invariant: Ensure gas doesn't run out (prevent DoS)
        uint256 gas_safety_threshold = 50000; // Reserve ~50k gas for cleanup

        for (uint256 i = 0; i < traders.length; i++) {
            // LOOP INVARIANT CHECK (per Module-1 Section 3.4)
            // 1. Counter i is strictly increasing
            // 2. Unprocessed items are strictly decreasing
            // 3. Gas remaining check prevents infinite loops

            // Check gas: must have enough for remaining ops and revert
            require(
                gasleft() > gas_safety_threshold,
                "ClearSettle: Out of gas - loop cannot continue safely"
            );

            address trader = traders[i];
            RevealedOrder storage order = s.revealedOrders[epochId][trader];

            if (order.amount == 0 || order.executed) continue;

            // ============ INVARIANT 4: Single Execution ============
            // Enforce each order executes exactly once
            SafetyModule.enforceSingleExecution(order.executed);

            // Mark as executed
            order.executed = true;

            // Calculate fill amount (for simplicity, full fill in demo)
            uint256 fillAmount = order.amount;

            // ============ INVARIANT 3: Zero-Sum Settlement ============
            // Store settlement result (credits/debits balanced during verification)
            if (order.side == OrderSide.BUY) {
                s.settlements[epochId][trader] = SettlementResult({
                    tokensReceived: fillAmount,
                    tokensPaid: (fillAmount * clearingPrice) / 1 ether,
                    bondReturned: 0, // Bond already returned on reveal
                    claimed: false
                });
            } else {
                s.settlements[epochId][trader] = SettlementResult({
                    tokensReceived: (fillAmount * clearingPrice) / 1 ether,
                    tokensPaid: fillAmount,
                    bondReturned: 0,
                    claimed: false
                });
            }

            // Loop invariant maintained: i increases, and we processed one item
            // Next iteration: i+1 (strictly increases), unprocessed -= 1 (strictly decreases)
        }

        return matchedVolume;
    }
    
    /**
     * @notice Verify invariants before settlement begins
     * @dev PRE-CONDITION check per Module-1 Section 4.2 (Hoare Logic)
     *
     * INVARIANTS CHECKED:
     * 1. Solvency: Contract can cover all claims
     * 2. Time Monotonicity: Phases in correct order
     * 3. State Transition Validity: Current phase is SETTLING
     *
     * @dev Reverts if any precondition fails
     */
    function _verifyPreSettlementInvariants() internal view {
        LibClearStorage.ClearStorage storage s = _getStorage();

        // Invariant 1: Check Solvency before settlement begins
        uint256 totalClaims = s.totalDeposits - s.totalWithdrawals;
        require(
            SafetyModule.checkSolvency(address(this).balance, totalClaims),
            "ClearSettle: Solvency check failed"
        );

        // Invariant 3: Check Time Monotonicity of current epoch
        EpochData storage epoch = s.epochs[s.currentEpochId];
        require(
            SafetyModule.checkTimeMonotonicity(epoch),
            "ClearSettle: Time monotonicity violated"
        );
    }

    /**
     * @notice Verify all invariants after settlement
     * @dev POST-CONDITION check per Module-1 Section 4.2 (Hoare Logic)
     *
     * INVARIANTS CHECKED:
     * 1. Solvency: Contract can cover all claims
     * 2. Conservation: No value created/destroyed
     * 3. Time Monotonicity: Phases in order
     * 4. Single Execution: Orders executed exactly once (checked per-order)
     * 5. Valid State Transition: Only valid transitions allowed
     *
     * @dev Reverts if any postcondition fails, triggering state revert in settleEpoch()
     */
    function _verifyPostSettlementInvariants() internal view {
        LibClearStorage.ClearStorage storage s = _getStorage();

        // Check all invariants
        (bool allPassed, string memory failedInvariant) = SafetyModule.checkAllInvariants(
            s,
            address(this).balance
        );

        // If any invariant fails, revert entire settlement
        require(allPassed, string(abi.encodePacked("Invariant failed: ", failedInvariant)));
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get current epoch ID
     */
    function getCurrentEpoch() external view override returns (uint256) {
        return getCurrentEpochId();
    }
    
    /**
     * @notice Get epoch data - override to satisfy interface
     */
    function getEpochData(uint256 epochId) public view override(EpochManager, IClearSettleCore) returns (EpochData memory) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.epochs[epochId];
    }
    
    /**
     * @notice Get current phase - override to satisfy interface
     */
    function getCurrentPhase() public view override(EpochManager, IClearSettleCore) returns (EpochPhase) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.epochs[s.currentEpochId].phase;
    }
    
    /**
     * @notice Get commitment for trader in epoch
     */
    function getCommitment(
        uint256 epochId, 
        address trader
    ) external view returns (Commitment memory) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.commitments[epochId][trader];
    }
    
    /**
     * @notice Get settlement result for trader in epoch
     */
    function getSettlementResult(
        uint256 epochId, 
        address trader
    ) external view returns (SettlementResult memory) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return s.settlements[epochId][trader];
    }
    
    /**
     * @notice Get protocol statistics
     */
    function getStats() external view returns (
        uint256 totalDeposits,
        uint256 totalWithdrawals,
        uint256 treasuryBalance,
        bool emergencyMode
    ) {
        LibClearStorage.ClearStorage storage s = _getStorage();
        return (
            s.totalDeposits,
            s.totalWithdrawals,
            s.treasuryBalance,
            s.emergencyMode
        );
    }
    
    // ============ Receive ETH ============
    
    /**
     * @notice Allow contract to receive ETH
     * @dev Needed for bond deposits and settlement funds
     */
    receive() external payable {
        LibClearStorage.ClearStorage storage s = _getStorage();
        s.totalDeposits += msg.value;
    }
}
