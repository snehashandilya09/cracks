// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LibClearStorage.sol";
import "../interfaces/IClearSettle.sol";

/**
 * @title SafetyModule
 * @author ClearSettle Team - TriHacker Tournament Finale
 * @notice Library for enforcing protocol invariants
 * @dev Implements the 5 core invariants required by the problem statement
 * 
 * INVARIANT ENFORCEMENT PHILOSOPHY:
 * =================================
 * "Define, then prove" - The problem statement requires us to not just
 * implement invariants, but to prove they hold. We use runtime verification
 * with assert() for critical invariants (causing transaction revert on violation)
 * and require() for input validation.
 * 
 * THE 5 CORE INVARIANTS:
 * ======================
 * 
 * 1. SOLVENCY INVARIANT
 *    Definition: Contract balance >= Total user claims
 *    Math: Σ(balances[user]) <= address(this).balance
 *    Risk Mitigated: Bank run, insolvency
 * 
 * 2. CONSERVATION OF VALUE INVARIANT
 *    Definition: Value in = Value out (accounting for fees)
 *    Math: deposits_in = withdrawals_out + current_balance + fees
 *    Risk Mitigated: Inflation bugs, token minting exploits
 * 
 * 3. MONOTONICITY OF TIME INVARIANT
 *    Definition: Phases progress forward, never backward
 *    Math: T_settle > T_reveal > T_commit
 *    Risk Mitigated: Time-travel attacks, state reversal
 * 
 * 4. SINGLE EXECUTION INVARIANT (Idempotency)
 *    Definition: Each order executes exactly once
 *    Math: Σ(executions[orderId]) <= 1
 *    Risk Mitigated: Replay attacks, double settlement
 * 
 * 5. STATE TRANSITION VALIDITY INVARIANT
 *    Definition: Only valid phase transitions allowed
 *    Math: transition(phase_i, phase_j) ∈ ValidTransitions
 *    Risk Mitigated: State machine bypasses, unauthorized finalization
 * 
 * HOARE LOGIC REPRESENTATION:
 * ===========================
 * For each function f that modifies state:
 * {P} f() {Q}
 * Where:
 *   P = Precondition (all invariants hold before)
 *   Q = Postcondition (all invariants hold after)
 */
library SafetyModule {
    using LibClearStorage for LibClearStorage.ClearStorage;
    
    // ============ Events ============

    event InvariantViolation(string invariantName, string details);
    event InvariantPassed(string invariantName);

    // ============ Formal Verification - Invariant Masks ============

    /**
     * @notice Invariant bit masks for formal verification
     * @dev Used in Hoare Logic modifiers to specify which invariants must hold
     *
     * USAGE:
     * modifier requiresInvariant(uint256 mask) {
     *     if (mask & INV_SOLVENCY != 0) checkSolvency();
     *     _;
     * }
     *
     * COMBINATION:
     * uint256 mask = INV_SOLVENCY | INV_CONSERVATION; // Both must hold
     */
    uint256 internal constant INV_SOLVENCY = 1 << 0;        // 0x01
    uint256 internal constant INV_CONSERVATION = 1 << 1;    // 0x02
    uint256 internal constant INV_MONOTONICITY = 1 << 2;    // 0x04
    uint256 internal constant INV_SINGLE_EXEC = 1 << 3;     // 0x08
    uint256 internal constant INV_VALID_TRANSITION = 1 << 4; // 0x10
    uint256 internal constant INV_ALL = 0x1F;               // All 5 invariants

    // ============ Invariant 1: Solvency ============
    
    /**
     * @notice Check Solvency Invariant
     * @param contractBalance Current ETH balance of contract
     * @param totalClaims Sum of all user claims (deposits - withdrawals)
     * @return passed True if invariant holds
     * 
     * MATHEMATICAL DEFINITION:
     * ∀ states S: balance(contract) >= Σ claims(user_i)
     * 
     * PROOF SKETCH:
     * 1. On deposit: balance += amount, claims[user] += amount → invariant preserved
     * 2. On withdraw: balance -= amount, claims[user] -= amount → invariant preserved
     * 3. No other operations modify balance or claims → invariant holds
     */
    function checkSolvency(
        uint256 contractBalance,
        uint256 totalClaims
    ) internal pure returns (bool passed) {
        passed = contractBalance >= totalClaims;
        // Note: Using assert would revert entire transaction
        // We return bool to allow graceful handling
    }
    
    /**
     * @notice Enforce Solvency Invariant (reverts on failure)
     * @param contractBalance Current ETH balance
     * @param totalClaims Sum of all claims
     * 
     * SECURITY: Uses assert() - violation indicates critical bug
     * assert() consumes all gas on failure (pre-Istanbul) or reverts with Panic
     */
    function enforceSolvency(
        uint256 contractBalance,
        uint256 totalClaims
    ) internal pure {
        assert(contractBalance >= totalClaims);
    }
    
    // ============ Invariant 2: Conservation of Value ============
    
    /**
     * @notice Check Conservation of Value Invariant
     * @param totalDeposits All-time deposits
     * @param totalWithdrawals All-time withdrawals
     * @param currentBalance Current contract balance
     * @param accumulatedFees Protocol fees collected
     * @return passed True if invariant holds
     * 
     * MATHEMATICAL DEFINITION:
     * deposits_in = withdrawals_out + current_balance
     * (fees are part of current_balance until withdrawn by protocol)
     * 
     * TOLERANCE:
     * We allow 1 wei tolerance for rounding errors in batch calculations
     */
    function checkConservation(
        uint256 totalDeposits,
        uint256 totalWithdrawals,
        uint256 currentBalance,
        uint256 accumulatedFees
    ) internal pure returns (bool passed) {
        // deposits = withdrawals + balance
        // Note: fees stay in contract until withdrawn, so included in balance
        uint256 expectedBalance = totalDeposits - totalWithdrawals;
        
        // Allow 1 wei tolerance for rounding
        if (currentBalance >= expectedBalance) {
            passed = (currentBalance - expectedBalance) <= 1;
        } else {
            passed = (expectedBalance - currentBalance) <= 1;
        }
    }
    
    /**
     * @notice Enforce Conservation Invariant (reverts on failure)
     */
    function enforceConservation(
        uint256 totalDeposits,
        uint256 totalWithdrawals,
        uint256 currentBalance,
        uint256 accumulatedFees
    ) internal pure {
        uint256 expectedBalance = totalDeposits - totalWithdrawals;
        uint256 diff = currentBalance > expectedBalance 
            ? currentBalance - expectedBalance 
            : expectedBalance - currentBalance;
        assert(diff <= 1); // 1 wei tolerance
    }
    
    // ============ Invariant 3: Monotonicity of Time ============
    
    /**
     * @notice Check Time Monotonicity Invariant
     * @param epoch The epoch data to check
     * @return passed True if all timestamps are monotonically increasing
     * 
     * MATHEMATICAL DEFINITION:
     * startBlock < commitEndBlock < revealEndBlock < settleBlock < safetyEndBlock
     * 
     * This ensures:
     * - No commits after commit phase
     * - No reveals after reveal phase
     * - Settlement happens in order
     * - Safety buffer respected
     */
    function checkTimeMonotonicity(
        EpochData memory epoch
    ) internal pure returns (bool passed) {
        // Skip if epoch not started
        if (epoch.startBlock == 0) return true;
        
        // Check monotonic ordering where applicable
        passed = true;
        
        if (epoch.commitEndBlock > 0) {
            passed = passed && (epoch.startBlock < epoch.commitEndBlock);
        }
        if (epoch.revealEndBlock > 0) {
            passed = passed && (epoch.commitEndBlock < epoch.revealEndBlock);
        }
        if (epoch.settleBlock > 0) {
            passed = passed && (epoch.revealEndBlock <= epoch.settleBlock);
        }
        if (epoch.safetyEndBlock > 0) {
            passed = passed && (epoch.settleBlock < epoch.safetyEndBlock);
        }
    }
    
    /**
     * @notice Enforce Time Monotonicity (reverts on failure)
     */
    function enforceTimeMonotonicity(
        EpochData memory epoch
    ) internal pure {
        assert(checkTimeMonotonicity(epoch));
    }
    
    // ============ Invariant 4: Single Execution (Idempotency) ============
    
    /**
     * @notice Check Single Execution Invariant
     * @param alreadyExecuted Whether order was previously executed
     * @return passed True if not already executed
     * 
     * MATHEMATICAL DEFINITION:
     * ∀ orders O: executions(O) ∈ {0, 1}
     * 
     * IMPLEMENTATION:
     * Before executing order: require(!executed)
     * After executing order: executed = true
     * 
     * This prevents replay attacks where same order is processed twice
     */
    function checkSingleExecution(
        bool alreadyExecuted
    ) internal pure returns (bool passed) {
        passed = !alreadyExecuted;
    }
    
    /**
     * @notice Enforce Single Execution (reverts on failure)
     */
    function enforceSingleExecution(
        bool alreadyExecuted
    ) internal pure {
        assert(!alreadyExecuted);
    }
    
    // ============ Invariant 5: State Transition Validity ============
    
    /**
     * @notice Check if state transition is valid
     * @param fromPhase Current phase
     * @param toPhase Target phase
     * @return passed True if transition is allowed
     *
     * VALID TRANSITION GRAPH (per Module-1 Section 2.2):
     *
     *   UNINITIALIZED
     *         │
     *         ▼
     *   ACCEPTING_COMMITS ◄───────────┐
     *         │                       │
     *         ▼                       │
     *   ACCEPTING_REVEALS             │
     *         │                       │
     *         ▼                       │
     *     SETTLING                    │
     *         │                       │
     *         ▼                       │
     *   IN_TRANSITION (CRITICAL)      │ (on error)
     *     ╱       ╲                   │
     *    ╱         ╲                  │
     *   ▼           ▼                 │
     * SAFETY_    VOID ─────────────────┘
     * BUFFER
     *   │
     *   ▼
     * FINALIZED
     *
     * AFSM AUGMENTATION (VeriSolid):
     * - SETTLING → IN_TRANSITION → SAFETY_BUFFER (normal path)
     * - IN_TRANSITION can fail → back to SETTLING or VOID (error handling)
     *
     * Special transitions:
     * - Any state → VOID (on invariant violation)
     * - FINALIZED → UNINITIALIZED (new epoch start)
     *
     * INVALID TRANSITIONS (examples):
     * - ACCEPTING_REVEALS → ACCEPTING_COMMITS (backward)
     * - ACCEPTING_COMMITS → FINALIZED (skipping phases)
     * - IN_TRANSITION → ACCEPTING_COMMITS (no escaping to non-sequential)
     */
    function checkValidTransition(
        EpochPhase fromPhase,
        EpochPhase toPhase
    ) internal pure returns (bool passed) {
        // Special case: Any → VOID (emergency)
        if (toPhase == EpochPhase.VOID) {
            return true;
        }

        // Normal transitions
        if (fromPhase == EpochPhase.UNINITIALIZED) {
            return toPhase == EpochPhase.ACCEPTING_COMMITS;
        }
        if (fromPhase == EpochPhase.ACCEPTING_COMMITS) {
            return toPhase == EpochPhase.ACCEPTING_REVEALS;
        }
        if (fromPhase == EpochPhase.ACCEPTING_REVEALS) {
            return toPhase == EpochPhase.SETTLING;
        }
        if (fromPhase == EpochPhase.SETTLING) {
            // CRITICAL: Must transition through IN_TRANSITION for safety
            return toPhase == EpochPhase.IN_TRANSITION;
        }
        if (fromPhase == EpochPhase.IN_TRANSITION) {
            // Can proceed to SAFETY_BUFFER on success
            // Or revert to SETTLING on error (handled by caller)
            // Or transition to VOID on critical failure
            return toPhase == EpochPhase.SAFETY_BUFFER || toPhase == EpochPhase.SETTLING;
        }
        if (fromPhase == EpochPhase.SAFETY_BUFFER) {
            return toPhase == EpochPhase.FINALIZED;
        }
        if (fromPhase == EpochPhase.FINALIZED) {
            // New epoch can start
            return toPhase == EpochPhase.UNINITIALIZED || toPhase == EpochPhase.ACCEPTING_COMMITS;
        }

        // VOID is terminal (no transitions out except new epoch)
        if (fromPhase == EpochPhase.VOID) {
            return toPhase == EpochPhase.UNINITIALIZED;
        }

        return false;
    }
    
    /**
     * @notice Enforce State Transition Validity (reverts on failure)
     */
    function enforceValidTransition(
        EpochPhase fromPhase,
        EpochPhase toPhase
    ) internal pure {
        assert(checkValidTransition(fromPhase, toPhase));
    }
    
    // ============ Combined Invariant Check ============
    
    /**
     * @notice Check all protocol invariants
     * @param s Storage pointer
     * @param contractBalance Current contract ETH balance
     * @return allPassed True if all invariants hold
     * @return failedInvariant Name of first failed invariant (empty if all pass)
     * 
     * USAGE:
     * Call this at the end of every state-modifying function
     * If any invariant fails, the function should revert
     * 
     * GAS CONSIDERATION:
     * This is expensive but security-critical
     * In production, consider checking only relevant invariants per function
     */
    function checkAllInvariants(
        LibClearStorage.ClearStorage storage s,
        uint256 contractBalance
    ) internal view returns (bool allPassed, string memory failedInvariant) {
        // Calculate total claims (simplified - sum of non-withdrawn settlements)
        // For full implementation, track total claims in storage
        uint256 totalClaims = s.totalDeposits - s.totalWithdrawals;
        
        // Invariant 1: Solvency
        if (!checkSolvency(contractBalance, totalClaims)) {
            return (false, "SOLVENCY");
        }
        
        // Invariant 2: Conservation
        if (!checkConservation(
            s.totalDeposits, 
            s.totalWithdrawals, 
            contractBalance,
            s.treasuryBalance
        )) {
            return (false, "CONSERVATION");
        }
        
        // Invariant 3: Time Monotonicity (check current epoch)
        EpochData storage currentEpoch = s.epochs[s.currentEpochId];
        if (!checkTimeMonotonicity(currentEpoch)) {
            return (false, "TIME_MONOTONICITY");
        }
        
        // Invariants 4 & 5 are checked at point of use (per-order, per-transition)
        
        return (true, "");
    }
    
    // ============ Batch Settlement Invariants ============
    
    /**
     * @notice Verify batch settlement conserves value
     * @param totalBuyValue Total value buyers are spending
     * @param totalSellValue Total value sellers are receiving
     * @param fees Fees collected by protocol
     * @return passed True if buy side equals sell side plus fees
     * 
     * BATCH AUCTION INVARIANT:
     * In a batch auction, all trades execute at uniform price
     * Total buyer payment = Total seller receipt + fees
     * 
     * This ensures no value is created or destroyed during settlement
     */
    function checkBatchConservation(
        uint256 totalBuyValue,
        uint256 totalSellValue,
        uint256 fees
    ) internal pure returns (bool passed) {
        // Buyers pay what sellers receive plus fees
        // Allow small rounding tolerance
        uint256 expected = totalSellValue + fees;
        if (totalBuyValue >= expected) {
            passed = (totalBuyValue - expected) <= 1;
        } else {
            passed = (expected - totalBuyValue) <= 1;
        }
    }
    
    /**
     * @notice Verify clearing price is fair
     * @param clearingPrice The uniform clearing price
     * @param minSellPrice Minimum price from sell orders
     * @param maxBuyPrice Maximum price from buy orders
     * @return passed True if clearing price is within valid range
     * 
     * FAIR PRICING INVARIANT:
     * clearingPrice <= maxBuyPrice (buyers don't overpay)
     * clearingPrice >= minSellPrice (sellers don't undersell)
     * 
     * This ensures the clearing price respects all limit orders
     */
    function checkFairClearing(
        uint256 clearingPrice,
        uint256 minSellPrice,
        uint256 maxBuyPrice
    ) internal pure returns (bool passed) {
        // Clearing price should be between min sell and max buy
        passed = (clearingPrice >= minSellPrice) && (clearingPrice <= maxBuyPrice);
    }
}
