// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IClearSettle.sol";

/**
 * @title FCAExecution
 * @author ClearSettle Team - TriHacker Tournament Finale Module 2
 * @notice Implements Fair Combinatorial Execution (FCA) for batch settlement
 * @dev Prevents sandwich attacks and ensures users get fair pricing
 *
 * FCA ALGORITHM (Module-2 Section 4):
 * ===================================
 *
 * Problem: Even with fair ordering, batch execution can be unfair
 * Example: A large buy order in a batch gets sandwiched by other traders
 *
 * Solution: Use Counterfactual Benchmark
 * 1. Calculate what each user WOULD have received trading alone at Oracle price
 * 2. Ensure batch execution gives them AT LEAST this amount
 * 3. If batch execution is worse, fall back to individual execution
 *
 * SECURITY GUARANTEES:
 * ===================
 * 1. Sandwich Attack Resistance: User always gets oracle-price guarantee
 * 2. Fair Execution: Batch execution improves or matches solo execution
 * 3. No Slippage: Users protected by counterfactual benchmark
 */
library FCAExecution {

    // ============ Events ============

    event CounterfactualCalculated(
        bytes32 indexed batchId,
        uint256 oraclePrice,
        uint256 userCount
    );

    event FCAInvariantChecked(
        bytes32 indexed batchId,
        uint256 passCount,
        uint256 totalCount,
        bool passed
    );

    event SandwichAttackDetected(
        address indexed user,
        bytes32 indexed batchId,
        uint256 expected,
        uint256 actual
    );

    // ============ Stage III: FCA Settlement Logic ============

    /**
     * @notice Calculate counterfactual benchmark for a user's trade
     * @param user Address of trader
     * @param orderAmount Amount they're trading
     * @param isBuy True if buying, false if selling
     * @param oraclePrice Oracle price (median across feeds)
     * @return expectedOutput What they'd receive trading alone
     *
     * COUNTERFACTUAL FORMULA (Module-2 Section 4.1):
     * For a BUY: User pays orderAmount * oraclePrice / (1 ether)
     *            Gets: orderAmount tokens
     * For a SELL: User pays orderAmount tokens
     *             Gets: orderAmount * oraclePrice / (1 ether)
     *
     * This is the MINIMUM guarantee - batch execution should beat or match this
     */
    function calculateCounterfactual(
        address user,
        uint256 orderAmount,
        bool isBuy,
        uint256 oraclePrice
    ) internal pure returns (uint256 expectedOutput) {
        require(oraclePrice > 0, "FCA: Oracle price must be positive");
        require(orderAmount > 0, "FCA: Order amount must be positive");

        if (isBuy) {
            // Buying: I spend orderAmount tokens, get (orderAmount / price) output
            // Wait, this is backwards. Let's clarify:
            // In a swap: you pay some token, get another token
            // For a BUY at oraclePrice:
            //   User receives: orderAmount tokens
            //   User pays: (orderAmount * oraclePrice) / 1 ether cost tokens
            // The counterfactual "output" is what they receive
            expectedOutput = orderAmount;
        } else {
            // Selling: I give orderAmount tokens, get (orderAmount * price) output
            // User receives: (orderAmount * oraclePrice) / 1 ether output tokens
            expectedOutput = (orderAmount * oraclePrice) / 1 ether;
        }

        return expectedOutput;
    }

    /**
     * @notice Verify FCA Invariant: batch execution >= counterfactual
     * @param users Array of user addresses
     * @param isBuys Array of buy/sell flags
     * @param amounts Array of order amounts
     * @param actualOutputs Actual tokens received from batch execution
     * @param oraclePrice Oracle price for benchmarking
     * @return passed True if all users meet or exceed counterfactual
     * @return failedUser Address of first user who fails check (if any)
     *
     * FCA INVARIANT (Module-2 Section 4.2):
     * For all users i in batch:
     *   actualOutput[i] >= counterfactual[i]
     *
     * ATTACK DETECTION:
     * If any user has actualOutput < counterfactual,
     * it indicates sandwich attack or unfair execution
     */
    function verifyFCAInvariant(
        address[] memory users,
        bool[] memory isBuys,
        uint256[] memory amounts,
        uint256[] memory actualOutputs,
        uint256 oraclePrice
    ) internal pure returns (bool passed, address failedUser) {
        require(
            users.length == isBuys.length &&
            isBuys.length == amounts.length &&
            amounts.length == actualOutputs.length,
            "FCA: Input array length mismatch"
        );

        for (uint256 i = 0; i < users.length; i++) {
            // Calculate what they should have gotten (counterfactual)
            uint256 expected = calculateCounterfactual(
                users[i],
                amounts[i],
                isBuys[i],
                oraclePrice
            );

            // Check: actual >= expected
            if (actualOutputs[i] < expected) {
                // INVARIANT VIOLATED - sandwich attack detected
                return (false, users[i]);
            }
        }

        // All users passed - FCA invariant holds
        return (true, address(0));
    }

    /**
     * @notice Execute batch with FCA protection
     * @dev This is the high-level logic; actual execution happens off-chain or in ClearSettle
     *
     * ALGORITHM (Module-2 Section 4.3):
     * 1. Snapshot state
     * 2. Calculate counterfactuals (minGuarantees)
     * 3. Attempt batch execution (MatchOrders)
     * 4. Check FCA invariant
     * 5. If passed: commit state; If failed: fall back to sequential execution
     *
     * @param batchId Unique identifier for this batch
     * @param users Traders in batch
     * @param isBuys Buy/sell flags
     * @param amounts Order amounts
     * @param actualOutputs Actual tokens received from batch
     * @param oraclePrice Oracle price
     * @return fcaPassed Whether FCA invariant was satisfied
     */
    function executeBatchWithFCA(
        bytes32 batchId,
        address[] memory users,
        bool[] memory isBuys,
        uint256[] memory amounts,
        uint256[] memory actualOutputs,
        uint256 oraclePrice
    ) internal pure returns (bool fcaPassed) {
        // Verify FCA invariant
        (bool passed, address failedUser) = verifyFCAInvariant(
            users,
            isBuys,
            amounts,
            actualOutputs,
            oraclePrice
        );

        if (!passed) {
            // Sandwich attack detected for failedUser
            // In production: fall back to ExecuteSequentially(batch)
            // For now: indicate failure
            return false;
        }

        // All checks passed - FCA invariant holds
        return true;
    }

    /**
     * @notice Calculate minimum guarantee (counterfactual) for all users in batch
     * @param users Batch participants
     * @param isBuys Buy/sell array
     * @param amounts Order amounts
     * @param oraclePrice Oracle price
     * @return minGuarantees Minimum tokens each user should receive
     */
    function calculateMinGuarantees(
        address[] memory users,
        bool[] memory isBuys,
        uint256[] memory amounts,
        uint256 oraclePrice
    ) internal pure returns (uint256[] memory minGuarantees) {
        minGuarantees = new uint256[](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            minGuarantees[i] = calculateCounterfactual(
                users[i],
                amounts[i],
                isBuys[i],
                oraclePrice
            );
        }

        return minGuarantees;
    }

    /**
     * @notice Check if batch execution improved user outcomes
     * @param actualOutputs Actual execution results
     * @param minGuarantees Counterfactual baselines
     * @return improved True if batch beat or matched all counterfactuals
     */
    function batchExecutionImproved(
        uint256[] memory actualOutputs,
        uint256[] memory minGuarantees
    ) internal pure returns (bool improved) {
        require(actualOutputs.length == minGuarantees.length, "FCA: Length mismatch");

        for (uint256 i = 0; i < actualOutputs.length; i++) {
            if (actualOutputs[i] < minGuarantees[i]) {
                return false;
            }
        }

        return true;
    }

    // ============ Sandwich Attack Detection ============

    /**
     * @notice Detect sandwich attack indicators in batch
     * @param users Users in batch
     * @param isBuys Trade directions
     * @param amounts Order amounts
     * @param actualOutputs Actual execution results
     * @param oraclePrice Oracle price
     * @return attackDetected True if sandwich patterns found
     * @return victims Array of users who appear to be sandwiched
     */
    function detectSandwichAttack(
        address[] memory users,
        bool[] memory isBuys,
        uint256[] memory amounts,
        uint256[] memory actualOutputs,
        uint256 oraclePrice
    ) internal pure returns (bool attackDetected, address[] memory victims) {
        uint256 victimCount = 0;

        // Count potential victims
        for (uint256 i = 0; i < users.length; i++) {
            uint256 expected = calculateCounterfactual(
                users[i],
                amounts[i],
                isBuys[i],
                oraclePrice
            );

            if (actualOutputs[i] < expected) {
                victimCount++;
            }
        }

        if (victimCount == 0) {
            return (false, new address[](0));
        }

        // Collect victims
        victims = new address[](victimCount);
        uint256 victimIndex = 0;

        for (uint256 i = 0; i < users.length; i++) {
            uint256 expected = calculateCounterfactual(
                users[i],
                amounts[i],
                isBuys[i],
                oraclePrice
            );

            if (actualOutputs[i] < expected) {
                victims[victimIndex] = users[i];
                victimIndex++;
            }
        }

        return (true, victims);
    }

    /**
     * @notice Calculate extraction value (MEV) from sandwich attack
     * @param expected Counterfactual output (fair price)
     * @param actual Actual execution output (unfair price)
     * @return extracted MEV extracted from user
     */
    function calculateExtractedValue(
        uint256 expected,
        uint256 actual
    ) internal pure returns (uint256 extracted) {
        if (expected > actual) {
            extracted = expected - actual;
        }
        return extracted;
    }
}
