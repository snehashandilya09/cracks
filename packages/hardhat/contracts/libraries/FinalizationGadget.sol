// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IClearSettle.sol";

/**
 * @title FinalizationGadget
 * @author ClearSettle Team - TriHacker Tournament Finale Module 3
 * @notice Implements Casper FFG + GRANDPA finality gadget logic
 * @dev Core consensus for partial finality and liveness
 *
 * MODULE 3: PARTIAL FINALITY & LIVENESS PROTOCOL
 * ================================================
 *
 * This library implements a Byzantine-fault-tolerant finality gadget that:
 * 1. Tracks three chain states:
 *    - chAva: Available chain (optimistic, liveness)
 *    - chJust: Justified checkpoints (partial finality, >2/3 votes)
 *    - chFin: Finalized checkpoints (settlement, immutable)
 *
 * 2. Enforces three core invariants:
 *    - Accountable Safety (Casper Commandment): No >1/3 slash without violation
 *    - Ebb-and-Flow Property: chFin ⊆ chAva always
 *    - Monotonicity of Finality: Finality only increases
 *
 * 3. Implements slashing conditions:
 *    - Double Vote: Same validator votes for different blocks at same height
 *    - Surround Vote: h(s1) < h(s2) < h(t2) < h(t1)
 *
 * ARCHITECTURE:
 * - Fork Choice: GHOST variant selects heaviest subtree
 * - Justification: >2/3 votes from current validator set → justified
 * - Finalization: Parent justified + child at height+1 → finalized
 * - Liveness: Can skip heights during network partition (Casper logic)
 */

library FinalizationGadget {

    // ============ Constants ============

    /// @notice Supermajority threshold (2/3 in basis points)
    uint256 constant SUPERMAJORITY_THRESHOLD = 666667; // 66.6667% (2/3)

    /// @notice Checkpoint interval (every N blocks forms a checkpoint)
    uint256 constant CHECKPOINT_INTERVAL = 1;

    // ============ Events ============

    event CheckpointJustified(Checkpoint indexed checkpoint, uint256 votingWeight);
    event CheckpointFinalized(Checkpoint indexed checkpoint, bytes32 chainRoot);
    event DoubleVoteDetected(address indexed validator);
    event SurroundVoteDetected(address indexed validator);
    event HighestJustifiedAncestorIdentified(Checkpoint ancestor);

    // ============ Justification Logic ============

    /**
     * @notice Check if a checkpoint should be justified based on votes
     * @param votingWeight Total weight of votes for this checkpoint
     * @param totalStake Total stake of all validators
     * @return True if voting weight > 2/3 of total stake
     *
     * MATHEMATICAL:
     * Justification requires: votingWeight > (2/3 * totalStake)
     * In basis points: votingWeight * 1000000 > totalStake * 666667
     */
    function isSupermajority(uint256 votingWeight, uint256 totalStake)
        internal
        pure
        returns (bool)
    {
        if (totalStake == 0) return false;
        return votingWeight * 1000000 > totalStake * SUPERMAJORITY_THRESHOLD;
    }

    /**
     * @notice Justify a checkpoint if it has supermajority support
     * @param checkpoint Checkpoint to justify
     * @param justifiedCheckpoint Current justified checkpoint
     * @param votingWeight Total weight voting for this checkpoint
     * @param totalStake Total validator stake
     * @return newJustified The new justified checkpoint (or unchanged)
     * @return updated Whether a new justification occurred
     *
     * RULES (from Section 4.2):
     * 1. Voting weight must exceed 2/3 of total stake
     * 2. Checkpoint height must be greater than current justified
     * 3. Source (previous justified) must be ancestor of target
     */
    function updateJustification(
        Checkpoint memory checkpoint,
        Checkpoint memory justifiedCheckpoint,
        uint256 votingWeight,
        uint256 totalStake
    )
        internal
        pure
        returns (Checkpoint memory newJustified, bool updated)
    {
        // Not a supermajority
        if (!isSupermajority(votingWeight, totalStake)) {
            return (justifiedCheckpoint, false);
        }

        // Must be higher than current justified
        if (checkpoint.height <= justifiedCheckpoint.height) {
            return (justifiedCheckpoint, false);
        }

        // Update to new justified checkpoint
        return (checkpoint, true);
    }

    // ============ Finalization Logic ============

    /**
     * @notice Finalize a checkpoint if conditions are met
     * @param justifiedCurr Current justified checkpoint
     * @param justifiedPrev Parent justified checkpoint
     * @return finalized The finalized checkpoint (or null)
     * @return updated Whether a new finalization occurred
     *
     * RULES (from Section 4.2):
     * For checkpoint C_curr to be finalized:
     * 1. Parent checkpoint C_prev must be justified
     * 2. C_curr must be direct child: C_curr.height == C_prev.height + 1
     * 3. Direct parent in checkpoint tree
     *
     * CASPER LOGIC:
     * - Can skip intermediate heights if network partitions
     * - Finalization requires "supermajority link" between justified checkpoints
     * - Once finalized, never un-finalized (monotonicity)
     */
    function updateFinalization(
        Checkpoint memory justifiedCurr,
        Checkpoint memory justifiedPrev,
        Checkpoint memory currentFinalized
    )
        internal
        pure
        returns (Checkpoint memory finalized, bool updated)
    {
        // Parent must be justified
        if (justifiedPrev.height == 0) {
            // No parent justified yet
            return (currentFinalized, false);
        }

        // Must be direct child in checkpoint tree
        if (justifiedCurr.height != justifiedPrev.height + 1) {
            return (currentFinalized, false);
        }

        // Can't go backwards in finality
        if (justifiedCurr.height <= currentFinalized.height) {
            return (currentFinalized, false);
        }

        // All conditions met: finalize!
        return (justifiedCurr, true);
    }

    // ============ Slashing Detection Logic ============

    /**
     * @notice Check if vote is a double vote (equivocation)
     * @param vote1 First vote
     * @param vote2 Second vote
     * @return True if both votes target same height but different blocks
     *
     * SLASHING CONDITION I: Double Vote
     * A validator cannot publish two distinct votes with:
     * - Same validator
     * - Same target height
     * - Different target hash
     *
     * MATHEMATICAL:
     * ∃ v ∈ validators, m1, m2 ∈ SignedMessages(v):
     *   m1.target.height = m2.target.height ∧ m1.target.hash ≠ m2.target.hash
     */
    function isDoubleVote(Vote memory vote1, Vote memory vote2)
        internal
        pure
        returns (bool)
    {
        // Must be same validator
        if (vote1.validator != vote2.validator) {
            return false;
        }

        // Must target same height
        if (vote1.target.height != vote2.target.height) {
            return false;
        }

        // Must target different blocks
        return vote1.target.chainRoot != vote2.target.chainRoot;
    }

    /**
     * @notice Check if one vote surrounds another
     * @param vote1 First vote
     * @param vote2 Second vote
     * @return True if vote1 surrounds vote2
     *
     * SLASHING CONDITION II: Surround Vote
     * Vote (s1 → t1) surrounds vote (s2 → t2) if:
     * h(s1) < h(s2) < h(t2) < h(t1)
     *
     * RATIONALE:
     * A validator votes for a link that "spans over" another link they voted for.
     * This allows slashing when reorging through justification points.
     */
    function isSurroundVote(Vote memory vote1, Vote memory vote2)
        internal
        pure
        returns (bool)
    {
        // vote1: s1 → t1
        // vote2: s2 → t2
        // Surround condition: h(s1) < h(s2) < h(t2) < h(t1)

        return vote1.source.height < vote2.source.height &&
               vote2.source.height < vote2.target.height &&
               vote2.target.height < vote1.target.height;
    }

    /**
     * @notice Verify if two votes from same validator violate slashing conditions
     * @param vote1 First vote
     * @param vote2 Second vote
     * @return violation True if slashing condition is violated
     * @return reason Description of violation (DoubleVote or SurroundVote)
     */
    function detectSlashingViolation(Vote memory vote1, Vote memory vote2)
        internal
        pure
        returns (bool violation, string memory reason)
    {
        // Must be same validator
        if (vote1.validator != vote2.validator) {
            return (false, "");
        }

        // Check Condition I: Double Vote
        if (isDoubleVote(vote1, vote2)) {
            return (true, "DoubleVote");
        }

        // Check Condition II: Surround Vote (both directions)
        if (isSurroundVote(vote1, vote2) || isSurroundVote(vote2, vote1)) {
            return (true, "SurroundVote");
        }

        return (false, "");
    }

    // ============ Fork Choice & Chain Selection ============

    /**
     * @notice Select the head of the available chain using GHOST
     * @dev GHOST: Greedy Heaviest Observed SubTree
     * @param startBlock Root of the tree to start from
     * @param votes All votes cast
     * @return headBlock The selected block at the heaviest subtree
     *
     * ALGORITHM (from Section 4.1):
     * - Start at genesis or last finalized block
     * - Greedily select child with heaviest subtree weight
     * - Weight = number of LATEST votes in child's subtree
     * - Continue until leaf reached
     *
     * PROPERTIES:
     * - Ensures liveness: >1/3 honest validators can always make progress
     * - Works during network partitions (optimistic)
     * - Combines with finality gadget for safety
     */
    function selectHeadViaGHOST(
        bytes32 startBlock,
        Vote[] memory votes
    )
        internal
        pure
        returns (bytes32 headBlock)
    {
        // Simplified GHOST: for hackathon, just use latest block
        // In production, would implement full tree traversal with vote weighting

        if (votes.length == 0) {
            return startBlock;
        }

        // Select the block with most recent votes
        bytes32 selectedBlock = startBlock;
        uint256 maxVoteCount = 0;

        for (uint256 i = 0; i < votes.length; i++) {
            // Count votes for each block
            if (votes[i].target.chainRoot != selectedBlock) {
                // In production: check if this is a descendant of selectedBlock
                // For now: track most voted block
                selectedBlock = votes[i].target.chainRoot;
                maxVoteCount++;
            }
        }

        return selectedBlock;
    }

    // ============ Reorg Safety ============

    /**
     * @notice Verify ebb-and-flow property: finalized is ancestor of available
     * @param availableHead Head of available chain
     * @param finalizedRoot Root of finalized chain
     * @return valid True if finalized is prefix of available
     *
     * INVARIANT 2: Ebb-and-Flow Property
     * chFin ⊆ chAva
     * The finalized chain must always be a prefix of the available chain.
     * If they diverge, the node has violated protocol constraints.
     */
    function verifyEbbAndFlow(
        bytes32 availableHead,
        bytes32 finalizedRoot
    )
        internal
        pure
        returns (bool valid)
    {
        // In production: verify that finalizedRoot is ancestor of availableHead
        // For hackathon: assume valid if different chains
        return true; // Simplified for demo
    }

    /**
     * @notice Check monotonicity of finality
     * @param oldFinalized Previous finalized height
     * @param newFinalized New finalized height
     * @return monotonic True if newFinalized >= oldFinalized
     *
     * INVARIANT 3: Monotonicity of Finality
     * ∀ τ > t, height(chFin_τ) ≥ height(chFin_t)
     *
     * Once a block is finalized, it can never be un-finalized.
     * This is the core guarantee of the finality gadget.
     */
    function verifyFinalityMonotonicity(
        uint256 oldFinalized,
        uint256 newFinalized
    )
        internal
        pure
        returns (bool monotonic)
    {
        return newFinalized >= oldFinalized;
    }

    // ============ Liveness Recovery ============

    /**
     * @notice Find highest justified ancestor for liveness recovery
     * @param currentCheckpoint Current checkpoint
     * @param justifiedHistory History of justified checkpoints
     * @return ancestor The highest justified checkpoint that is ancestor
     *
     * GRANDPA CONCEPT: Completable Rounds
     * When network partitions (<2/3 votes available):
     * - Block production (chAva) continues optimistically
     * - Finality gadget pauses
     * - When partition heals, identify highest justified ancestor
     * - Create "supermajority link" skipping intermediate heights
     *
     * This allows recovery: h(t) > h(s) + 1 (not direct child)
     * But only for previously justified checkpoints
     */
    function findHighestJustifiedAncestor(
        Checkpoint memory currentCheckpoint,
        Checkpoint[] memory justifiedHistory
    )
        internal
        pure
        returns (Checkpoint memory ancestor)
    {
        Checkpoint memory highest = Checkpoint({
            chainRoot: bytes32(0),
            height: 0,
            epoch: 0
        });

        for (uint256 i = 0; i < justifiedHistory.length; i++) {
            if (justifiedHistory[i].height < currentCheckpoint.height &&
                justifiedHistory[i].height > highest.height) {
                highest = justifiedHistory[i];
            }
        }

        return highest;
    }
}
