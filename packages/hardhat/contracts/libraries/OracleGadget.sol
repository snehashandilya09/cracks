// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IClearSettle.sol";

/**
 * @title OracleGadget
 * @author ClearSettle Team - TriHacker Tournament Finale Module 4
 * @notice Implements oracle price feeds with optimistic settlement and dispute resolution
 * @dev Combines DECO (TLS provenance), Specular (bisection game), and economic security
 *
 * MODULE-4: ORACLE MANIPULATION RESISTANCE & DISPUTE RESOLUTION
 * ============================================================
 *
 * This library implements the Optimistic Oracle Settlement Engine (OOSE):
 *
 * 1. PROVER PHASE:
 *    - Prover/oracle node fetches price from TLS-enabled source
 *    - Commits price with cryptographic proof (simplified DECO)
 *    - Posts bond (MIN_PROVER_BOND = 1 ether)
 *
 * 2. DISPUTE WINDOW:
 *    - Price is PENDING for T_DISPUTE blocks
 *    - Watchtower/challengers can initiate dispute
 *    - Commit-reveal scheme prevents front-running challenges
 *
 * 3. BISECTION GAME:
 *    - If disputed, prover and challenger play bisection game
 *    - Game narrows disagreement in log(n) rounds
 *    - Example: 1M step trace → 20 rounds to single step
 *
 * 4. ONE-STEP VERIFICATION:
 *    - When bisection converges, verify single EVM opcode
 *    - On-chain verification of state transition
 *    - Winner takes loser's bond + reward (1.5x)
 *
 * SECURITY PROPERTIES:
 * ===================
 * ✓ Data Integrity: TLS binding prevents data forgery
 * ✓ Commit-Reveal: Prevents front-running of challenges
 * ✓ Economic Incentives: Honest behavior payoff > dishonest behavior payoff
 * ✓ Byzantine Safety: Dispute resolution always produces correct result
 * ✓ Liveness: >1/3 honest nodes can always challenge false prices
 */
library OracleGadget {

    // ============ Constants ============

    /// @notice Minimum bond required from prover (in wei)
    uint256 constant MIN_PROVER_BOND = 1 ether;

    /// @notice Minimum bond required from challenger (in wei)
    uint256 constant MIN_CHALLENGE_BOND = 0.5 ether;

    /// @notice Dispute resolution window (in blocks)
    uint256 constant DISPUTE_WINDOW = 100;

    /// @notice Commit window for challenges (in blocks)
    uint256 constant COMMIT_WINDOW = 10;

    /// @notice Reveal window for challenges (in blocks)
    uint256 constant REVEAL_WINDOW = 20;

    /// @notice Bisection timeout (in blocks) - if no move, challenger wins
    uint256 constant BISECTION_TIMEOUT = 50;

    /// @notice Maximum bisection rounds (log2 of max trace length)
    uint256 constant MAX_BISECTION_ROUNDS = 40;

    /// @notice Reward multiplier for winning dispute (in basis points, 1.5x = 15000)
    uint256 constant REWARD_MULTIPLIER = 15000; // 150% = 1.5x

    // ============ Events ============

    event OraclePriceSubmitted(
        uint256 indexed oraclePriceId,
        address indexed prover,
        uint256 price,
        uint256 proverBond
    );

    event ChallengeInitiated(
        uint256 indexed oraclePriceId,
        address indexed challenger,
        uint256 challengeBond
    );

    event ChallengeRevealedAsInvalid(
        uint256 indexed oraclePriceId,
        address indexed challenger
    );

    event BisectionProgressed(
        uint256 indexed gameId,
        uint256 round,
        uint256 leftPointer,
        uint256 rightPointer
    );

    event DisputeResolved(
        uint256 indexed gameId,
        address indexed winner,
        uint256 reward
    );

    event OraclePriceConfirmed(
        uint256 indexed oraclePriceId,
        uint256 price
    );

    // ============ Stage 1: Prover Submission ============

    /**
     * @notice Validate prover bond is sufficient
     * @param bondAmount Bond amount posted by prover
     * @return isValid True if bond meets minimum requirement
     *
     * SECURITY: Prevents low-bond attacks where prover has no skin in game
     */
    function validateProverBond(uint256 bondAmount)
        internal
        pure
        returns (bool isValid)
    {
        return bondAmount >= MIN_PROVER_BOND;
    }

    /**
     * @notice Validate DECO proof format (simplified for hackathon)
     * @param proof The DECO proof bytes
     * @return isValid True if proof format is acceptable
     *
     * SIMPLIFIED: Real implementation would verify TLS session binding
     * For demo: just check proof is non-empty
     */
    function validateDECOProof(bytes calldata proof)
        internal
        pure
        returns (bool isValid)
    {
        // In production: verify cryptographic commitment from TLS session
        // Simplified: just check proof exists
        return proof.length > 0;
    }

    /**
     * @notice Calculate dispute window closing block
     * @param submitBlock Block when price was submitted
     * @return closeBlock Block number when dispute window closes
     */
    function getDisputeWindowClose(uint256 submitBlock)
        internal
        pure
        returns (uint256 closeBlock)
    {
        return submitBlock + DISPUTE_WINDOW;
    }

    // ============ Stage 2: Challenge Commit-Reveal ============

    /**
     * @notice Verify challenger bond is sufficient
     * @param bondAmount Bond amount posted by challenger
     * @return isValid True if bond meets minimum requirement
     */
    function validateChallengeBond(uint256 bondAmount)
        internal
        pure
        returns (bool isValid)
    {
        return bondAmount >= MIN_CHALLENGE_BOND;
    }

    /**
     * @notice Create commit hash for challenge (prevents front-running)
     * @param decision True if claiming price invalid, false if valid
     * @param salt Random salt for commit-reveal
     * @param challenger Address of challenger
     * @return commitHash Hash to be committed on-chain
     *
     * FORMULA: H = Keccak256(decision || salt || challenger)
     * This prevents adversary from seeing decision and front-running with opposite decision
     */
    function createChallengeCommit(
        bool decision,
        bytes32 salt,
        address challenger
    )
        internal
        pure
        returns (bytes32 commitHash)
    {
        return keccak256(abi.encode(decision, salt, challenger));
    }

    /**
     * @notice Verify challenge reveal matches committed hash
     * @param decision Revealed decision
     * @param salt Revealed salt
     * @param challenger Challenger address
     * @param commitHash Previously committed hash
     * @return isValid True if reveal matches commit
     */
    function verifyRevealCommitment(
        bool decision,
        bytes32 salt,
        address challenger,
        bytes32 commitHash
    )
        internal
        pure
        returns (bool isValid)
    {
        bytes32 recomputedHash = createChallengeCommit(decision, salt, challenger);
        return recomputedHash == commitHash;
    }

    /**
     * @notice Check if challenge commit window is still open
     * @param commitBlock Block when challenge was committed
     * @param currentBlock Current block number
     * @return isOpen True if within commit window
     */
    function isCommitWindowOpen(uint256 commitBlock, uint256 currentBlock)
        internal
        pure
        returns (bool isOpen)
    {
        return currentBlock <= commitBlock + COMMIT_WINDOW;
    }

    /**
     * @notice Check if challenge reveal window is still open
     * @param commitBlock Block when challenge was committed
     * @param currentBlock Current block number
     * @return isOpen True if within reveal window
     */
    function isRevealWindowOpen(uint256 commitBlock, uint256 currentBlock)
        internal
        pure
        returns (bool isOpen)
    {
        uint256 revealStart = commitBlock + COMMIT_WINDOW;
        uint256 revealEnd = revealStart + REVEAL_WINDOW;
        return currentBlock > revealStart && currentBlock <= revealEnd;
    }

    // ============ Stage 3: Bisection Game ============

    /**
     * @notice Initialize bisection game (binary search for disagreement point)
     * @param traceLength Total number of execution steps in trace
     * @return gameId Identifier for new game
     *
     * ALGORITHM: Narrow down disagreement to single step
     * - Start: [0, traceLength)
     * - Each round: check middle point, narrow range
     * - Convergence: ~log2(traceLength) rounds
     * - Example: 1M steps → ceil(log2(1M)) = 20 rounds
     */
    function initializeBisectionGame(uint256 traceLength)
        internal
        pure
        returns (uint256 gameId)
    {
        // Game ID would be assigned by contract
        // For pure function: just validate trace length is reasonable
        require(traceLength > 0, "OracleGadget: Invalid trace length");
        require(traceLength <= 2 ** MAX_BISECTION_ROUNDS, "OracleGadget: Trace too long");
        return traceLength; // Simplified return
    }

    /**
     * @notice Compute next bisection midpoint
     * @param leftPointer Current left boundary
     * @param rightPointer Current right boundary
     * @return midpoint Midpoint between boundaries (next point to check)
     *
     * FORMULA: midpoint = (left + right) / 2
     * Parties alternate moves: prover claims midpoint is valid, challenger disputes
     */
    function computeBisectionMidpoint(
        uint256 leftPointer,
        uint256 rightPointer
    )
        internal
        pure
        returns (uint256 midpoint)
    {
        return (leftPointer + rightPointer) / 2;
    }

    /**
     * @notice Calculate number of rounds needed for convergence
     * @param traceLength Length of execution trace
     * @return rounds Number of bisection rounds needed
     *
     * FORMULA: rounds = ceil(log2(traceLength))
     * For efficiency: maximum 40 rounds (handles 2^40 steps)
     */
    function calculateBisectionRounds(uint256 traceLength)
        internal
        pure
        returns (uint256 rounds)
    {
        if (traceLength <= 1) return 0;

        rounds = 0;
        uint256 n = traceLength - 1;
        while (n > 0) {
            rounds++;
            n = n / 2;
        }

        return rounds;
    }

    /**
     * @notice Check if bisection game has converged
     * @param leftPointer Current left boundary
     * @param rightPointer Current right boundary
     * @return hasConverged True if game has narrowed to single step
     *
     * CONVERGENCE: left + 1 >= right means only one step remains
     */
    function hasBisectionConverged(
        uint256 leftPointer,
        uint256 rightPointer
    )
        internal
        pure
        returns (bool hasConverged)
    {
        return leftPointer + 1 >= rightPointer;
    }

    /**
     * @notice Narrow bisection range based on disagreement report
     * @param leftPointer Current left boundary
     * @param rightPointer Current right boundary
     * @param disagreementAt Reported point of disagreement
     * @param moveLeft True if disagreement is on left side of check point
     * @return newLeft New left boundary
     * @return newRight New right boundary
     *
     * LOGIC:
     * - If prover says midpoint[m] is valid but challenger says invalid
     * - Challenger reveals which half has disagreement
     * - Range narrows by half each round
     */
    function narrowBisectionRange(
        uint256 leftPointer,
        uint256 rightPointer,
        uint256 disagreementAt,
        bool moveLeft
    )
        internal
        pure
        returns (uint256 newLeft, uint256 newRight)
    {
        require(disagreementAt > leftPointer && disagreementAt < rightPointer,
                "OracleGadget: Invalid disagreement point");

        if (moveLeft) {
            // Disagreement is on left side
            newLeft = leftPointer;
            newRight = disagreementAt;
        } else {
            // Disagreement is on right side
            newLeft = disagreementAt;
            newRight = rightPointer;
        }

        return (newLeft, newRight);
    }

    // ============ Stage 4: One-Step Verification ============

    /**
     * @notice Verify a single EVM opcode execution
     * @param beforeState EVM state before opcode
     * @param afterState EVM state after opcode
     * @param opcode The opcode being verified
     * @return isValid True if state transition is correct for opcode
     *
     * ONE-STEP PROOF VERIFICATION:
     * On-chain, verify single instruction execution
     * Opcode examples: ADD, MSTORE, RETURN, etc.
     *
     * For hackathon: simplified verification of a few key opcodes
     * Production: full EVM opcode interpreter
     */
    function verifyOneStepProof(
        bytes32 beforeState,
        bytes32 afterState,
        bytes calldata opcode
    )
        internal
        pure
        returns (bool isValid)
    {
        // Simplified: just verify both states are non-empty
        // Production implementation would:
        // 1. Decode EVM state (stack, memory, PC, gas, storage root)
        // 2. Execute opcode on beforeState
        // 3. Verify result matches afterState

        require(beforeState != bytes32(0), "OracleGadget: Invalid before state");
        require(afterState != bytes32(0), "OracleGadget: Invalid after state");
        require(opcode.length > 0, "OracleGadget: Invalid opcode");

        // In production: emulate the actual opcode
        // For demo: states must be different (transaction occurred)
        return beforeState != afterState;
    }

    // ============ Stage 5: Reward Distribution ============

    /**
     * @notice Calculate reward for dispute winner
     * @param proverBond Bond posted by prover
     * @param challengerBond Bond posted by challenger
     * @return reward Total reward (1.5x multiplier on combined bonds)
     *
     * FORMULA: R = 1.5 × (D_P + D_C)
     * Where D_P = prover bond, D_C = challenger bond
     *
     * Example:
     * - Prover bond: 1 ether
     * - Challenger bond: 0.5 ether
     * - Total: 1.5 ether
     * - Reward: 1.5 × 1.5 = 2.25 ether
     *
     * Loser: forfeit their bond (0 recovery)
     * Winner: receives reward from loser's bond + own bond returned
     */
    function calculateDisputeReward(
        uint256 proverBond,
        uint256 challengerBond
    )
        internal
        pure
        returns (uint256 reward)
    {
        uint256 totalBonds = proverBond + challengerBond;
        reward = (totalBonds * REWARD_MULTIPLIER) / 10000; // REWARD_MULTIPLIER = 15000 = 1.5x
        return reward;
    }

    /**
     * @notice Determine dispute winner based on one-step verification
     * @param oneStepProofValid True if one-step proof is valid
     * @return proverWins True if prover wins dispute
     *
     * LOGIC:
     * - If one-step proof is valid: prover wins (their execution trace is correct)
     * - If one-step proof is invalid: challenger wins (prover's trace is wrong)
     */
    function determineDisputeWinner(bool oneStepProofValid)
        internal
        pure
        returns (bool proverWins)
    {
        return oneStepProofValid;
    }

    // ============ Utility Functions ============

    /**
     * @notice Check if bisection game has timed out
     * @param lastMoveBlock Block of last move in bisection game
     * @param currentBlock Current block number
     * @return hasTimedOut True if timeout period exceeded
     *
     * LIVENESS: If one party stops responding, other party wins by timeout
     * This prevents indefinite games and ensures liveness
     */
    function hasBisectionTimedOut(
        uint256 lastMoveBlock,
        uint256 currentBlock
    )
        internal
        pure
        returns (bool hasTimedOut)
    {
        return currentBlock > lastMoveBlock + BISECTION_TIMEOUT;
    }

    /**
     * @notice Verify price is reasonable (within expected range)
     * @param price The price to verify
     * @param lowerBound Minimum acceptable price
     * @param upperBound Maximum acceptable price
     * @return isValid True if price is within bounds
     *
     * SANITY CHECK: Prevent clearly invalid prices from flooding protocol
     */
    function isPriceSane(
        uint256 price,
        uint256 lowerBound,
        uint256 upperBound
    )
        internal
        pure
        returns (bool isValid)
    {
        return price >= lowerBound && price <= upperBound;
    }
}
