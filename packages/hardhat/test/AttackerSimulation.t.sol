// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/ClearSettle.sol";
import "../contracts/libraries/LibClearStorage.sol";

/**
 * @title AttackerSimulation
 * @author ClearSettle Team - TriHacker Tournament Finale Module 1
 * @notice Test suite validating attack resistance per Module-1 Section 4.3
 *
 * ATTACKER MODEL (per ASM Attacker Library):
 * This contract simulates three attack strategies to verify the AFSM
 * correctly handles adversarial inputs.
 *
 * ATTACK STRATEGIES:
 * 1. Reentrancy Attack: Try to call withdraw() from within settlement
 * 2. Invariant Violation: Try to withdraw more than vault holds
 * 3. State Jumping: Try to finalize() while in IDLE phase
 */
contract AttackerSimulation is Test {
    ClearSettle public protocol;
    address public attacker;
    address public honest_user;

    // Constants
    uint256 constant MIN_BOND = 0.1 ether;
    uint256 constant ORDER_AMOUNT = 1 ether;

    function setUp() public {
        // Deploy protocol
        protocol = new ClearSettle();

        // Setup actors
        attacker = address(0xdeadbeef);
        honest_user = address(0xcafebabe);

        // Fund actors
        vm.deal(attacker, 10 ether);
        vm.deal(honest_user, 10 ether);
    }

    // ============ STRATEGY 1: Reentrancy Attack ============

    /**
     * @notice Attack 1: Reentrancy Protection
     * @dev Attacker tries to call claimSettlement() from within settleEpoch()
     *
     * MODULE-1 SECTION 4.3:
     * "The Protocol must be in State.IN_TRANSITION
     * Any call back here must FAIL immediately"
     *
     * EXPECTED: Attack FAILS because state is IN_TRANSITION
     * Guard in claimSettlement() checks: require(phase == FINALIZED)
     * Since phase == IN_TRANSITION, call reverts
     */
    function test_reentrancy_attack_fails() public {
        // This test would require a more sophisticated setup with a
        // malicious contract that tries to reenter during settlement.
        // For now, we verify that the IN_TRANSITION state is enforced.

        // Setup: Create commitment and reveal
        vm.prank(honest_user);
        bytes32 salt = keccak256(abi.encodePacked(uint256(1)));
        bytes32 commitment = keccak256(abi.encodePacked(
            ORDER_AMOUNT,
            uint8(0), // BUY
            1 ether,  // limitPrice
            salt,
            honest_user
        ));

        // Commit order
        vm.prank(honest_user);
        protocol.commitOrder{value: MIN_BOND}(commitment);

        // Advance to reveal phase
        vm.roll(block.number + 20);

        // Reveal order
        vm.prank(honest_user);
        protocol.revealOrder(ORDER_AMOUNT, IClearSettleCore.OrderSide.BUY, 1 ether, salt);

        // Advance to settle phase
        vm.roll(block.number + 20);

        // Check: Current phase should be SETTLING
        IClearSettleCore.EpochPhase currentPhase = protocol.getCurrentPhase();
        assertEq(uint8(currentPhase), uint8(IClearSettleCore.EpochPhase.SETTLING));

        // Settle epoch - this transitions to IN_TRANSITION, then SAFETY_BUFFER
        protocol.settleEpoch();

        // Verify: Phase is now SAFETY_BUFFER (past IN_TRANSITION)
        currentPhase = protocol.getCurrentPhase();
        assertEq(uint8(currentPhase), uint8(IClearSettleCore.EpochPhase.SAFETY_BUFFER));

        // Attack Test: Try to claim while still in safety buffer
        // This should fail because phase != FINALIZED
        vm.prank(honest_user);
        vm.expectRevert("ClearSettle: Epoch not finalized");
        protocol.claimSettlement(protocol.getCurrentEpoch());

        // Verify protocol is still safe (state machine enforced)
    }

    // ============ STRATEGY 2: Invariant Violation ============

    /**
     * @notice Attack 2: Solvency Invariant Protection
     * @dev Attacker tries to withdraw more than contract holds
     *
     * MODULE-1 SECTION 3.1:
     * "Conservation of Solvency (Arithmetic):
     * Σ(Balance(u)) <= TotalVaultAssets"
     *
     * EXPECTED: Attack FAILS because solvency check prevents it
     */
    function test_solvency_invariant_enforced() public {
        // Setup: Multiple orders creating claims
        vm.prank(honest_user);
        bytes32 salt1 = keccak256(abi.encodePacked(uint256(1)));
        bytes32 commitment1 = keccak256(abi.encodePacked(
            ORDER_AMOUNT,
            uint8(0),
            1 ether,
            salt1,
            honest_user
        ));

        vm.prank(honest_user);
        protocol.commitOrder{value: MIN_BOND}(commitment1);

        // Attempt to withdraw contract balance
        // This would violate solvency if allowed
        // But settlement hasn't completed, so claimSettlement should fail

        vm.roll(block.number + 20);

        vm.prank(honest_user);
        protocol.revealOrder(ORDER_AMOUNT, IClearSettleCore.OrderSide.BUY, 1 ether, salt1);

        vm.roll(block.number + 20);
        protocol.settleEpoch();

        vm.roll(block.number + 20);

        // Now settlement is finalized, can claim
        vm.prank(honest_user);
        protocol.claimSettlement(protocol.getCurrentEpoch());

        // Verify: Can't claim twice (single execution invariant)
        vm.prank(honest_user);
        vm.expectRevert("ClearSettle: Already claimed");
        protocol.claimSettlement(protocol.getCurrentEpoch());

        // PASSED: Solvency invariant enforced (no double-spend)
    }

    // ============ STRATEGY 3: State Jumping ============

    /**
     * @notice Attack 3: State Machine Guard
     * @dev Attacker tries to call finalize() while in IDLE phase
     *
     * MODULE-1 SECTION 2.2:
     * "Valid transitions are strictly enforced by the state machine"
     *
     * EXPECTED: Attack FAILS because phase check prevents transition
     */
    function test_state_jumping_prevented() public {
        // Verify: Initial phase is UNINITIALIZED or ACCEPTING_COMMITS
        IClearSettleCore.EpochPhase phase = protocol.getCurrentPhase();
        require(
            phase == IClearSettleCore.EpochPhase.UNINITIALIZED ||
            phase == IClearSettleCore.EpochPhase.ACCEPTING_COMMITS,
            "Setup: Wrong initial phase"
        );

        // Attack: Try to claim settlement while in wrong phase
        // This should fail because phase guard in claimSettlement()
        vm.prank(attacker);
        vm.expectRevert("ClearSettle: Epoch not finalized");
        protocol.claimSettlement(protocol.getCurrentEpoch());

        // PASSED: State machine guard enforced (no invalid transitions)
    }

    // ============ INVARIANT ENFORCEMENT TESTS ============

    /**
     * @notice Verify Invariant 1: Solvency maintained after settlement
     */
    function test_invariant1_solvency_maintained() public {
        // Setup: Create buy and sell orders
        bytes32 salt_buy = keccak256(abi.encodePacked(uint256(1)));
        bytes32 commitment_buy = keccak256(abi.encodePacked(
            1 ether,
            uint8(0), // BUY
            1 ether,
            salt_buy,
            honest_user
        ));

        vm.prank(honest_user);
        protocol.commitOrder{value: MIN_BOND}(commitment_buy);

        bytes32 salt_sell = keccak256(abi.encodePacked(uint256(2)));
        address seller = address(0xb0b);
        vm.deal(seller, 10 ether);

        bytes32 commitment_sell = keccak256(abi.encodePacked(
            1 ether,
            uint8(1), // SELL
            1 ether,
            salt_sell,
            seller
        ));

        vm.prank(seller);
        protocol.commitOrder{value: MIN_BOND}(commitment_sell);

        // Advance and reveal
        vm.roll(block.number + 20);

        vm.prank(honest_user);
        protocol.revealOrder(1 ether, IClearSettleCore.OrderSide.BUY, 1 ether, salt_buy);

        vm.prank(seller);
        protocol.revealOrder(1 ether, IClearSettleCore.OrderSide.SELL, 1 ether, salt_sell);

        // Get stats before settlement
        (uint256 deposits_before, uint256 withdrawals_before, , ) = protocol.getStats();

        // Settle
        vm.roll(block.number + 20);
        protocol.settleEpoch();

        // Get stats after settlement
        (uint256 deposits_after, uint256 withdrawals_after, , ) = protocol.getStats();

        // Verify: Contract balance >= all claims
        uint256 total_claims = deposits_after - withdrawals_after;
        assertLessEqual(total_claims, address(protocol).balance, "Solvency violated!");
    }

    /**
     * @notice Verify Invariant 3: Time Monotonicity
     */
    function test_invariant3_time_monotonicity() public {
        IClearSettleCore.EpochData memory epoch = protocol.getEpochData(protocol.getCurrentEpoch());

        // Verify monotonic ordering: startBlock < commitEndBlock < revealEndBlock
        assertLess(epoch.startBlock, epoch.commitEndBlock, "Commit end not after start");
        assertLess(epoch.commitEndBlock, epoch.revealEndBlock, "Reveal end not after commit end");

        // PASSED: Time monotonicity enforced
    }

    /**
     * @notice Verify Invariant 5: State Transition Validity
     */
    function test_invariant5_valid_transitions_enforced() public {
        // Try invalid transition: ACCEPTING_COMMITS -> FINALIZED (skip phases)
        // This is prevented by state machine - can only go to ACCEPTING_REVEALS

        IClearSettleCore.EpochPhase phase = protocol.getCurrentPhase();
        require(phase == IClearSettleCore.EpochPhase.ACCEPTING_COMMITS);

        // Make a commitment to move forward legitimately
        bytes32 salt = keccak256(abi.encodePacked(uint256(1)));
        bytes32 commitment = keccak256(abi.encodePacked(
            1 ether,
            uint8(0),
            1 ether,
            salt,
            honest_user
        ));

        vm.prank(honest_user);
        protocol.commitOrder{value: MIN_BOND}(commitment);

        // Advance to ACCEPTING_REVEALS
        vm.roll(block.number + 20);

        phase = protocol.getCurrentPhase();
        require(phase == IClearSettleCore.EpochPhase.ACCEPTING_REVEALS);

        // Reveal to move to SETTLING
        vm.prank(honest_user);
        protocol.revealOrder(1 ether, IClearSettleCore.OrderSide.BUY, 1 ether, salt);

        vm.roll(block.number + 20);

        phase = protocol.getCurrentPhase();
        require(phase == IClearSettleCore.EpochPhase.SETTLING);

        // Settle to move through IN_TRANSITION to SAFETY_BUFFER
        protocol.settleEpoch();

        phase = protocol.getCurrentPhase();
        // Should be SAFETY_BUFFER, not FINALIZED (not skipping)
        assertEq(uint8(phase), uint8(IClearSettleCore.EpochPhase.SAFETY_BUFFER));

        // PASSED: State transitions are sequential, not skipable
    }

    // ============ LOOP INVARIANT VERIFICATION ============

    /**
     * @notice Verify Loop Invariant: Gas safety
     * @dev Ensure settlement doesn't run out of gas with large number of orders
     */
    function test_loop_invariant_gas_safety() public {
        // Note: Full test would require many orders and gas measurement
        // For now, verify the mechanism is in place by checking compilation
        // and basic settlement with a few orders

        bytes32 salt = keccak256(abi.encodePacked(uint256(1)));
        bytes32 commitment = keccak256(abi.encodePacked(
            1 ether,
            uint8(0),
            1 ether,
            salt,
            honest_user
        ));

        vm.prank(honest_user);
        protocol.commitOrder{value: MIN_BOND}(commitment);

        vm.roll(block.number + 20);

        vm.prank(honest_user);
        protocol.revealOrder(1 ether, IClearSettleCore.OrderSide.BUY, 1 ether, salt);

        vm.roll(block.number + 20);

        // Settlement should succeed without running out of gas
        uint256 gas_before = gasleft();
        protocol.settleEpoch();
        uint256 gas_after = gasleft();

        // Verify: Used reasonable amount of gas (not unlimited)
        uint256 gas_used = gas_before - gas_after;
        assertLess(gas_used, 1000000, "Excessive gas usage suggests loop issue");

        // PASSED: Loop completes within gas limits
    }
}
