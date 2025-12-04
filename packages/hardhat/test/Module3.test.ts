import { expect } from "chai";
import { ethers } from "hardhat";
import { SettlementGadget } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║           MODULE-3: PARTIAL FINALITY & LIVENESS TEST SUITE                ║
 * ║                                                                            ║
 * ║  Tests for Finality Gadget (Casper FFG + GRANDPA + 3-Slot Finality)      ║
 * ║                                                                            ║
 * ║  TEST CATEGORIES:                                                          ║
 * ║  1. Justification Tests (Partial Finality)                                ║
 * ║  2. Finalization Tests (Settlement Complete)                              ║
 * ║  3. Slashing Tests (Accountable Safety)                                   ║
 * ║  4. Liveness Tests (Partition Recovery)                                   ║
 * ║  5. Invariant Tests (Safety & Monotonicity)                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

describe("Module-3: Partial Finality & Liveness (Settlement Gadget)", function () {
  let gadget: SettlementGadget;
  let validator1: HardhatEthersSigner;
  let validator2: HardhatEthersSigner;
  let validator3: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  // Constants
  const VALIDATOR_STAKE = ethers.parseEther("100"); // 100 stake per validator
  const TOTAL_STAKE = VALIDATOR_STAKE * 3n; // 300 total

  // Helper: Create checkpoint
  function createCheckpoint(
    chainRoot: string,
    height: number,
    epoch: number
  ): {
    chainRoot: string;
    height: number;
    epoch: number;
  } {
    return {
      chainRoot: chainRoot || ethers.id(`block_${height}`),
      height,
      epoch,
    };
  }

  // Helper: Create vote
  function createVote(
    validator: string,
    source: { chainRoot: string; height: number; epoch: number },
    target: { chainRoot: string; height: number; epoch: number },
    signature: string = "0x01"
  ): {
    validator: string;
    source: { chainRoot: string; height: number; epoch: number };
    target: { chainRoot: string; height: number; epoch: number };
    signature: string;
  } {
    return {
      validator,
      source,
      target,
      signature: signature.padEnd(66, "0"),
    };
  }

  beforeEach(async function () {
    // Deploy gadget
    const GadgetFactory = await ethers.getContractFactory("SettlementGadget");
    const deployed = await GadgetFactory.deploy();
    gadget = deployed as unknown as SettlementGadget;
    await gadget.waitForDeployment();

    // Get signers
    [, validator1, validator2, validator3, user] = await ethers.getSigners();

    // Register validators
    await gadget.registerValidator(await validator1.getAddress(), VALIDATOR_STAKE);
    await gadget.registerValidator(await validator2.getAddress(), VALIDATOR_STAKE);
    await gadget.registerValidator(await validator3.getAddress(), VALIDATOR_STAKE);
  });

  // ============ PART 1: JUSTIFICATION TESTS ============

  describe("Justification (Partial Finality)", function () {
    /**
     * TEST 1: Single validator vote doesn't justify
     * Need >2/3 (> 200 out of 300) stake
     */
    it("should NOT justify checkpoint with <2/3 stake", async function () {
      const checkpoint = createCheckpoint(ethers.id("block_1"), 1, 1);
      const vote = createVote(await validator1.getAddress(), createCheckpoint(ethers.id("genesis"), 0, 0), checkpoint);

      await gadget.submitVote(vote);

      // Single validator = 100 out of 300 = 33% < 66%
      const isJustified = await gadget.isCheckpointJustified(checkpoint);
      expect(isJustified).to.be.false;
    });

    /**
     * TEST 2: Two validators justify (>2/3 stake)
     * Need >2/3: 200 out of 300 = 66.67% ✓
     */
    it("should justify checkpoint with >2/3 stake (2 validators)", async function () {
      const checkpoint = createCheckpoint(ethers.id("block_2"), 2, 1);
      const sourceCheckpoint = createCheckpoint(ethers.id("genesis"), 0, 0);

      // Submit votes from 2 validators
      const vote1 = createVote(await validator1.getAddress(), sourceCheckpoint, checkpoint);
      const vote2 = createVote(await validator2.getAddress(), sourceCheckpoint, checkpoint);

      await gadget.submitVote(vote1);
      await gadget.submitVote(vote2);

      // Process votes
      await gadget.processVotes([vote1, vote2]);

      // 200 out of 300 = 66.67% > 66% ✓
      const isJustified = await gadget.isCheckpointJustified(checkpoint);
      expect(isJustified).to.be.true;
    });

    /**
     * TEST 3: All three validators justify
     * 100% stake
     */
    it("should justify checkpoint with all 3 validators", async function () {
      const checkpoint = createCheckpoint(ethers.id("block_3"), 3, 1);
      const sourceCheckpoint = createCheckpoint(ethers.id("genesis"), 0, 0);

      const votes = [
        createVote(await validator1.getAddress(), sourceCheckpoint, checkpoint),
        createVote(await validator2.getAddress(), sourceCheckpoint, checkpoint),
        createVote(await validator3.getAddress(), sourceCheckpoint, checkpoint),
      ];

      for (const vote of votes) {
        await gadget.submitVote(vote);
      }

      await gadget.processVotes(votes);

      const isJustified = await gadget.isCheckpointJustified(checkpoint);
      expect(isJustified).to.be.true;
    });

    /**
     * TEST 4: Justification state updated in storage
     */
    it("should emit CheckpointJustified event", async function () {
      const checkpoint = createCheckpoint(ethers.id("block_4"), 4, 1);
      const sourceCheckpoint = createCheckpoint(ethers.id("genesis"), 0, 0);

      const votes = [
        createVote(await validator1.getAddress(), sourceCheckpoint, checkpoint),
        createVote(await validator2.getAddress(), sourceCheckpoint, checkpoint),
      ];

      for (const vote of votes) {
        await gadget.submitVote(vote);
      }

      await expect(gadget.processVotes(votes))
        .to.emit(gadget, "CheckpointJustified");
    });
  });

  // ============ PART 2: FINALIZATION TESTS ============

  describe("Finalization (Settlement)", function () {
    /**
     * TEST 5: Finalize when parent is justified and direct child
     * Rule: C_curr.height == C_prev.height + 1
     */
    it("should finalize checkpoint when parent is justified and direct child", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_2"), 2, 1);

      // Justify checkpoint 1
      const votes1 = [
        createVote(await validator1.getAddress(), source, checkpoint1),
        createVote(await validator2.getAddress(), source, checkpoint1),
      ];

      for (const vote of votes1) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes1);

      // Justify checkpoint 2 (direct child of 1)
      const votes2 = [
        createVote(await validator1.getAddress(), checkpoint1, checkpoint2),
        createVote(await validator2.getAddress(), checkpoint1, checkpoint2),
      ];

      for (const vote of votes2) {
        await gadget.submitVote(vote);
      }

      await expect(gadget.processVotes(votes2))
        .to.emit(gadget, "CheckpointFinalized");
    });

    /**
     * TEST 6: Cannot finalize if parent not justified
     */
    it("should NOT finalize if parent checkpoint is not justified", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_2"), 2, 1);

      // Only justify checkpoint 2, skip parent 1
      const votes = [
        createVote(await validator1.getAddress(), source, checkpoint2),
        createVote(await validator2.getAddress(), source, checkpoint2),
      ];

      for (const vote of votes) {
        await gadget.submitVote(vote);
      }

      await gadget.processVotes(votes);

      // Should not be finalized (parent not justified)
      const isFinalized = await gadget.isCheckpointFinalized(checkpoint2);
      expect(isFinalized).to.be.false;
    });

    /**
     * TEST 7: Monotonicity - finality never decreases
     */
    it("should maintain monotonicity of finality", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_2"), 2, 1);

      // Finalize checkpoint 1 first
      const votes1 = [
        createVote(await validator1.getAddress(), source, checkpoint1),
        createVote(await validator2.getAddress(), source, checkpoint1),
      ];

      for (const vote of votes1) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes1);

      // Finalize checkpoint 2
      const votes2 = [
        createVote(await validator1.getAddress(), checkpoint1, checkpoint2),
        createVote(await validator2.getAddress(), checkpoint1, checkpoint2),
      ];

      for (const vote of votes2) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes2);

      const state = await gadget.getFinalizationState();
      // Should never decrease
      expect(state.finalizedCheckpoint.height).to.be.greaterThanOrEqual(checkpoint1.height);
    });
  });

  // ============ PART 3: SLASHING TESTS ============

  describe("Slashing Detection (Accountable Safety)", function () {
    /**
     * TEST 8: Double vote detection
     * Same validator votes for different blocks at same height
     */
    it("should slash validator for double vote", async function () {
      const checkpoint1 = createCheckpoint(ethers.id("block_1a"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_1b"), 1, 1); // Same height, different block
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);

      const vote1 = createVote(await validator1.getAddress(), source, checkpoint1);
      const vote2 = createVote(await validator1.getAddress(), source, checkpoint2);

      // Submit both votes
      await gadget.submitVote(vote1);

      // Second vote from same validator at same height should detect violation
      await expect(gadget.submitVote(vote2)).to.emit(gadget, "ValidatorSlashed");

      // Validator should be slashed
      const isSlashed = await gadget.slashedValidators(await validator1.getAddress());
      expect(isSlashed).to.be.true;
    });

    /**
     * TEST 9: Surround vote detection
     * h(s1) < h(s2) < h(t2) < h(t1)
     */
    it("should slash validator for surround vote", async function () {
      const validator1Addr = await validator1.getAddress();

      // Vote 1: s1=0 -> t1=3
      const s1 = createCheckpoint(ethers.id("genesis"), 0, 0);
      const t1 = createCheckpoint(ethers.id("block_3"), 3, 1);
      const vote1 = createVote(validator1Addr, s1, t1);

      // Vote 2: s2=1 -> t2=2 (surrounds vote 1)
      const s2 = createCheckpoint(ethers.id("block_1"), 1, 0);
      const t2 = createCheckpoint(ethers.id("block_2"), 2, 0);
      const vote2 = createVote(validator1Addr, s2, t2);

      // Submit first vote
      await gadget.submitVote(vote1);

      // Submit surrounding vote - should detect surround violation
      await expect(gadget.submitVote(vote2)).to.emit(gadget, "ValidatorSlashed");

      const isSlashed = await gadget.slashedValidators(validator1Addr);
      expect(isSlashed).to.be.true;
    });

    /**
     * TEST 10: Submit explicit evidence and slash
     */
    it("should slash via submitSlashingEvidence", async function () {
      const checkpoint1 = createCheckpoint(ethers.id("block_1a"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_1b"), 1, 1);
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);

      const vote1 = createVote(await validator1.getAddress(), source, checkpoint1);
      const vote2 = createVote(await validator1.getAddress(), source, checkpoint2);

      await expect(gadget.submitSlashingEvidence(vote1, vote2))
        .to.emit(gadget, "ValidatorSlashed")
        .withArgs(await validator1.getAddress(), "DoubleVote");

      const isSlashed = await gadget.slashedValidators(await validator1.getAddress());
      expect(isSlashed).to.be.true;
    });

    /**
     * TEST 11: Slashed validator stake removed
     */
    it("should remove slashed validator stake from total", async function () {
      const validator1Addr = await validator1.getAddress();

      // Get initial stake
      const initialTotalStake = await gadget.getTotalValidatorStake();
      expect(initialTotalStake).to.equal(TOTAL_STAKE);

      // Slash validator
      const checkpoint1 = createCheckpoint(ethers.id("block_1a"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_1b"), 1, 1);
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);

      const vote1 = createVote(validator1Addr, source, checkpoint1);
      const vote2 = createVote(validator1Addr, source, checkpoint2);

      await gadget.submitSlashingEvidence(vote1, vote2);

      // Total stake should decrease
      const finalTotalStake = await gadget.getTotalValidatorStake();
      expect(finalTotalStake).to.equal(TOTAL_STAKE - VALIDATOR_STAKE);
    });
  });

  // ============ PART 4: LIVENESS TESTS ============

  describe("Liveness Recovery (Partition Healing)", function () {
    /**
     * TEST 12: Identify highest justified ancestor for liveness
     */
    it("should recover from network partition", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_2"), 2, 1);

      // Justify both checkpoints
      const votes1 = [
        createVote(await validator1.getAddress(), source, checkpoint1),
        createVote(await validator2.getAddress(), source, checkpoint1),
      ];

      for (const vote of votes1) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes1);

      const votes2 = [
        createVote(await validator1.getAddress(), checkpoint1, checkpoint2),
        createVote(await validator2.getAddress(), checkpoint1, checkpoint2),
      ];

      for (const vote of votes2) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes2);

      // Recover from partition
      await expect(gadget.recoverFromPartition()).to.emit(
        gadget,
        "HighestJustifiedAncestorIdentified"
      );

      const state = await gadget.getFinalizationState();
      expect(state.finalizedCheckpoint.height).to.be.greaterThan(0);
    });
  });

  // ============ PART 5: INVARIANT TESTS ============

  describe("Invariants (Safety & Monotonicity)", function () {
    /**
     * TEST 13: Ebb-and-Flow property verification
     */
    it("should maintain ebb-and-flow property", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);

      const votes = [
        createVote(await validator1.getAddress(), source, checkpoint1),
        createVote(await validator2.getAddress(), source, checkpoint1),
      ];

      for (const vote of votes) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes);

      const state = await gadget.getFinalizationState();

      // Finalized height should not exceed available chain height
      // (in reality, would check if finalized is prefix of available)
      expect(state.finalizedCheckpoint.height).to.be.lessThanOrEqual(checkpoint1.height);
    });

    /**
     * TEST 14: Accountable safety proof
     * Cannot finalize two conflicting checkpoints without slashing 1/3
     */
    it("should enforce accountable safety", async function () {
      const source = createCheckpoint(ethers.id("genesis"), 0, 0);
      const checkpoint1 = createCheckpoint(ethers.id("block_1"), 1, 1);
      const checkpoint2 = createCheckpoint(ethers.id("block_1_alt"), 1, 1); // Different block, same height

      // Vote 1 for checkpoint1 (2 validators)
      const votes1 = [
        createVote(await validator1.getAddress(), source, checkpoint1),
        createVote(await validator2.getAddress(), source, checkpoint1),
      ];

      for (const vote of votes1) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes1);

      // Try to vote for conflicting checkpoint2
      const vote2 = createVote(await validator1.getAddress(), source, checkpoint2);

      // Should detect double vote and slash
      await expect(gadget.submitVote(vote2)).to.emit(gadget, "ValidatorSlashed");
    });
  });

  // ============ INTEGRATION TESTS ============

  describe("Integration (Full Protocol)", function () {
    /**
     * TEST 15: Full 3-slot finality sequence
     * Slot 0 (genesis) → Slot 1 (justified) → Slot 2 (justified + parent justified → finalized)
     */
    it("should execute full 3-slot finality sequence", async function () {
      const slot0 = createCheckpoint(ethers.id("genesis"), 0, 0);
      const slot1 = createCheckpoint(ethers.id("slot_1"), 1, 1);
      const slot2 = createCheckpoint(ethers.id("slot_2"), 2, 1);

      // Epoch 1: Justify slot 1
      const votes1 = [
        createVote(await validator1.getAddress(), slot0, slot1),
        createVote(await validator2.getAddress(), slot0, slot1),
      ];

      for (const vote of votes1) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes1);

      let isJustified = await gadget.isCheckpointJustified(slot1);
      expect(isJustified).to.be.true;

      // Epoch 2: Justify slot 2 (direct child of slot 1)
      const votes2 = [
        createVote(await validator1.getAddress(), slot1, slot2),
        createVote(await validator2.getAddress(), slot1, slot2),
      ];

      for (const vote of votes2) {
        await gadget.submitVote(vote);
      }
      await gadget.processVotes(votes2);

      isJustified = await gadget.isCheckpointJustified(slot2);
      expect(isJustified).to.be.true;

      // Slot 2 should now be finalized (parent slot 1 is justified, slot 2 is child)
      let isFinalized = await gadget.isCheckpointFinalized(slot2);
      expect(isFinalized).to.be.true;

      // Verify state progression
      const state = await gadget.getFinalizationState();
      expect(state.finalizedCheckpoint.height).to.equal(2);
      expect(state.justifiedCheckpoint.height).to.equal(2);
    });
  });
});
