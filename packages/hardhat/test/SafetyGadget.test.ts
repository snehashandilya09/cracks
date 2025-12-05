import { expect } from "chai";
import { ethers } from "hardhat";
import { SafetyGadgetHarness } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * SafetyGadget Module 5 Tests
 * 
 * Tests the three critical security mechanisms:
 * 1. Nullifier Pattern - Prevents double-settlement/replay attacks
 * 2. Lookback Distance - Prevents Time-Bandit attacks
 * 3. Ancestry Verification - Detects chain reorganizations
 */
describe("SafetyGadget - Module 5 Reorg Safety", function () {
  let safetyGadget: SafetyGadgetHarness;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  // Test constants
  const LOOKBACK_DISTANCE = 64n;
  const TEST_PAYLOAD_HASH = ethers.keccak256(ethers.toUtf8Bytes("test_payload"));
  const TEST_SETTLEMENT_ID = ethers.keccak256(ethers.toUtf8Bytes("settlement_001"));

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const SafetyGadgetFactory = await ethers.getContractFactory("SafetyGadgetHarness");
    safetyGadget = await SafetyGadgetFactory.deploy();
    await safetyGadget.waitForDeployment();
  });

  // Helper to mine blocks
  async function mineBlocks(count: number) {
    for (let i = 0; i < count; i++) {
      await ethers.provider.send("evm_mine", []);
    }
  }

  describe("Constants Verification", function () {
    it("should have LOOKBACK_DISTANCE = 64", async function () {
      const lookback = await safetyGadget.LOOKBACK_DISTANCE();
      expect(lookback).to.equal(64n);
      console.log("    ✓ LOOKBACK_DISTANCE:", lookback.toString(), "blocks");
    });

    it("should have MAX_BLOCKHASH_AGE = 256", async function () {
      const maxAge = await safetyGadget.MAX_BLOCKHASH_AGE();
      expect(maxAge).to.equal(256n);
      console.log("    ✓ MAX_BLOCKHASH_AGE:", maxAge.toString(), "blocks");
    });
  });

  describe("Nullifier Pattern (Replay Protection)", function () {
    it("should compute deterministic nullifier from sender + nonce + payload + chainId", async function () {
      const nonce = 1n;
      
      // Compute nullifier
      const nullifier = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      
      // Verify it's deterministic (same inputs = same output)
      const nullifier2 = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      expect(nullifier).to.equal(nullifier2);
      
      console.log("    ✓ Nullifier computed:", nullifier.slice(0, 20) + "...");
    });

    it("should produce different nullifiers for different senders", async function () {
      const nonce = 1n;
      
      const nullifier1 = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      const nullifier2 = await safetyGadget.computeNullifier(user2.address, nonce, TEST_PAYLOAD_HASH);
      
      expect(nullifier1).to.not.equal(nullifier2);
      console.log("    ✓ Different senders produce different nullifiers");
    });

    it("should produce different nullifiers for different nonces", async function () {
      const nullifier1 = await safetyGadget.computeNullifier(user1.address, 1n, TEST_PAYLOAD_HASH);
      const nullifier2 = await safetyGadget.computeNullifier(user1.address, 2n, TEST_PAYLOAD_HASH);
      
      expect(nullifier1).to.not.equal(nullifier2);
      console.log("    ✓ Different nonces produce different nullifiers");
    });

    it("should produce different nullifiers for different payloads", async function () {
      const payload1 = ethers.keccak256(ethers.toUtf8Bytes("payload_A"));
      const payload2 = ethers.keccak256(ethers.toUtf8Bytes("payload_B"));
      
      const nullifier1 = await safetyGadget.computeNullifier(user1.address, 1n, payload1);
      const nullifier2 = await safetyGadget.computeNullifier(user1.address, 1n, payload2);
      
      expect(nullifier1).to.not.equal(nullifier2);
      console.log("    ✓ Different payloads produce different nullifiers");
    });

    it("should allow consuming a nullifier once", async function () {
      const nonce = 1n;
      
      // Check not consumed initially
      const nullifier = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      expect(await safetyGadget.isNullifierConsumed(nullifier)).to.be.false;
      
      // Consume it
      const tx = await safetyGadget.consumeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      await tx.wait();
      
      // Verify it's now consumed
      expect(await safetyGadget.isNullifierConsumed(nullifier)).to.be.true;
      console.log("    ✓ Nullifier consumed successfully");
    });

    it("should emit NullifierConsumed event", async function () {
      const nonce = 1n;
      const nullifier = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      
      await expect(safetyGadget.consumeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH))
        .to.emit(safetyGadget, "NullifierConsumed")
        .withArgs(nullifier, user1.address);
      
      console.log("    ✓ NullifierConsumed event emitted correctly");
    });

    it("should REVERT when trying to reuse a consumed nullifier (DOUBLE-SPEND PREVENTION)", async function () {
      const nonce = 1n;
      
      // First consumption succeeds
      await safetyGadget.consumeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      
      // Second consumption should fail
      const nullifier = await safetyGadget.computeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH);
      await expect(safetyGadget.consumeNullifier(user1.address, nonce, TEST_PAYLOAD_HASH))
        .to.be.revertedWithCustomError(safetyGadget, "NullifierAlreadyConsumed")
        .withArgs(nullifier);
      
      console.log("    ✓ Double-spend attack BLOCKED!");
    });
  });

  describe("Chain Snapshot Recording", function () {
    it("should record snapshot with correct block number and hash", async function () {
      const currentBlock = await ethers.provider.getBlockNumber();
      
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      const snapshot = await safetyGadget.getSnapshot(TEST_SETTLEMENT_ID);
      
      expect(snapshot.exists).to.be.true;
      expect(snapshot.blockNumber).to.equal(currentBlock + 1); // +1 because recordSnapshot is in next block
      expect(snapshot.status).to.equal(1n); // LOGGED = 1
      expect(snapshot.blockHash).to.not.equal(ethers.ZeroHash);
      
      console.log("    ✓ Snapshot recorded at block:", snapshot.blockNumber.toString());
      console.log("    ✓ Block hash:", snapshot.blockHash.slice(0, 20) + "...");
    });

    it("should emit SnapshotRecorded event", async function () {
      await expect(safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID))
        .to.emit(safetyGadget, "SnapshotRecorded");
      
      console.log("    ✓ SnapshotRecorded event emitted");
    });

    it("should REVERT when trying to record duplicate snapshot", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      await expect(safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID))
        .to.be.revertedWithCustomError(safetyGadget, "SnapshotAlreadyExists")
        .withArgs(TEST_SETTLEMENT_ID);
      
      console.log("    ✓ Duplicate snapshot prevention working");
    });
  });

  describe("Finality Status Tracking", function () {
    it("should return PENDING for non-existent settlement", async function () {
      const unknownId = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      const status = await safetyGadget.getFinalityStatus(unknownId);
      expect(status).to.equal(0n); // PENDING = 0
      console.log("    ✓ Non-existent settlement: PENDING (0)");
    });

    it("should return LOGGED immediately after snapshot", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      const status = await safetyGadget.getFinalityStatus(TEST_SETTLEMENT_ID);
      expect(status).to.equal(1n); // LOGGED = 1
      console.log("    ✓ After snapshot: LOGGED (1)");
    });

    it("should return CHECKPOINTED after lookback distance", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      // Mine 64 blocks
      await mineBlocks(64);
      
      const status = await safetyGadget.getFinalityStatus(TEST_SETTLEMENT_ID);
      expect(status).to.equal(2n); // CHECKPOINTED = 2
      console.log("    ✓ After 64 blocks: CHECKPOINTED (2)");
    });
  });

  describe("Lookback Distance Enforcement (Time-Bandit Defense)", function () {
    it("should report correct blocks until checkpoint", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      const blocksRemaining = await safetyGadget.blocksUntilCheckpoint(TEST_SETTLEMENT_ID);
      expect(blocksRemaining).to.equal(LOOKBACK_DISTANCE);
      console.log("    ✓ Blocks until checkpoint:", blocksRemaining.toString());
    });

    it("should decrease blocks remaining as blocks are mined", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      await mineBlocks(10);
      
      const blocksRemaining = await safetyGadget.blocksUntilCheckpoint(TEST_SETTLEMENT_ID);
      expect(blocksRemaining).to.equal(LOOKBACK_DISTANCE - 10n);
      console.log("    ✓ After 10 blocks, remaining:", blocksRemaining.toString());
    });

    it("should return 0 blocks remaining after lookback distance met", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      await mineBlocks(70);
      
      const blocksRemaining = await safetyGadget.blocksUntilCheckpoint(TEST_SETTLEMENT_ID);
      expect(blocksRemaining).to.equal(0n);
      console.log("    ✓ After 70 blocks, remaining: 0 (safe to finalize)");
    });

    it("should REVERT ancestry verification if lookback not met (TIME-BANDIT PREVENTION)", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      // Only mine 10 blocks (not enough)
      await mineBlocks(10);
      
      // Note: blocks passed = 11 (10 mined + 1 for verifyAncestry tx)
      await expect(safetyGadget.verifyAncestry(TEST_SETTLEMENT_ID))
        .to.be.revertedWithCustomError(safetyGadget, "LookbackDistanceNotMet");
      
      console.log("    ✓ Time-Bandit attack BLOCKED! (not enough blocks passed)");
    });
  });

  describe("Ancestry Verification (Reorg Detection)", function () {
    it("should pass ancestry verification after lookback distance (happy path)", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      // Mine enough blocks
      await mineBlocks(65);
      
      // Verify ancestry - should not revert
      await expect(safetyGadget.verifyAncestry(TEST_SETTLEMENT_ID))
        .to.emit(safetyGadget, "AncestryVerified");
      
      console.log("    ✓ Ancestry verified successfully after 65 blocks");
    });

    it("should update status to CHECKPOINTED after verification", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      await mineBlocks(65);
      
      await safetyGadget.verifyAncestry(TEST_SETTLEMENT_ID);
      
      const snapshot = await safetyGadget.getSnapshot(TEST_SETTLEMENT_ID);
      expect(snapshot.status).to.equal(2n); // CHECKPOINTED
      console.log("    ✓ Status updated to CHECKPOINTED");
    });

    it("should REVERT for non-existent snapshot", async function () {
      const unknownId = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
      
      await expect(safetyGadget.verifyAncestry(unknownId))
        .to.be.revertedWithCustomError(safetyGadget, "SnapshotNotFound")
        .withArgs(unknownId);
      
      console.log("    ✓ Non-existent snapshot correctly rejected");
    });

    it("should report isSafeToFinalize = false before lookback", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      const safe = await safetyGadget.isSafeToFinalize(TEST_SETTLEMENT_ID);
      expect(safe).to.be.false;
      console.log("    ✓ isSafeToFinalize = false (too early)");
    });

    it("should report isSafeToFinalize = true after lookback", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      await mineBlocks(65);
      
      const safe = await safetyGadget.isSafeToFinalize(TEST_SETTLEMENT_ID);
      expect(safe).to.be.true;
      console.log("    ✓ isSafeToFinalize = true (safe to finalize)");
    });

    it("should provide detailed reason via canVerifyAncestry", async function () {
      await safetyGadget.recordSnapshot(TEST_SETTLEMENT_ID);
      
      // Before lookback
      let [canVerify, reason] = await safetyGadget.canVerifyAncestry(TEST_SETTLEMENT_ID);
      expect(canVerify).to.be.false;
      expect(reason).to.equal("Lookback distance not met");
      console.log("    ✓ Before lookback:", reason);
      
      // After lookback
      await mineBlocks(65);
      [canVerify, reason] = await safetyGadget.canVerifyAncestry(TEST_SETTLEMENT_ID);
      expect(canVerify).to.be.true;
      expect(reason).to.equal("");
      console.log("    ✓ After lookback: Can verify = true");
    });
  });

  describe("Integration: Full Settlement Flow", function () {
    it("should execute complete safe settlement flow", async function () {
      console.log("\n    📋 FULL SETTLEMENT FLOW SIMULATION:");
      
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("settlement_full_test"));
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes("transfer:Alice->Bob:100USDC"));
      const nonce = 42n;
      
      // Step 1: Submit settlement (consume nullifier)
      console.log("    Step 1: Submitting settlement...");
      await safetyGadget.consumeNullifier(user1.address, nonce, payloadHash);
      console.log("    ✓ Nullifier consumed - replay protection active");
      
      // Step 2: Record snapshot (pre-commit)
      console.log("    Step 2: Recording chain snapshot (pre-commit)...");
      await safetyGadget.recordSnapshot(settlementId);
      const snapshot = await safetyGadget.getSnapshot(settlementId);
      console.log("    ✓ Snapshot at block", snapshot.blockNumber.toString());
      
      // Step 3: Wait for lookback
      console.log("    Step 3: Waiting for lookback distance (64 blocks)...");
      let blocksLeft = await safetyGadget.blocksUntilCheckpoint(settlementId);
      console.log("    - Blocks remaining:", blocksLeft.toString());
      
      await mineBlocks(64);
      
      blocksLeft = await safetyGadget.blocksUntilCheckpoint(settlementId);
      console.log("    - After mining 64: Blocks remaining:", blocksLeft.toString());
      
      // Step 4: Verify ancestry and finalize
      console.log("    Step 4: Verifying ancestry (reorg check)...");
      const safe = await safetyGadget.isSafeToFinalize(settlementId);
      console.log("    - Safe to finalize:", safe);
      
      await safetyGadget.verifyAncestry(settlementId);
      console.log("    ✓ Ancestry verified - no reorg detected");
      
      // Step 5: Verify final state
      const finalSnapshot = await safetyGadget.getSnapshot(settlementId);
      const statusNames = ["PENDING", "LOGGED", "CHECKPOINTED"];
      console.log("    ✓ Final status:", statusNames[Number(finalSnapshot.status)]);
      
      expect(finalSnapshot.status).to.equal(2n); // CHECKPOINTED
      console.log("\n    🎉 SETTLEMENT SAFELY FINALIZED!");
    });

    it("should BLOCK double-settlement attack across full flow", async function () {
      console.log("\n    ⚔️  DOUBLE-SETTLEMENT ATTACK SIMULATION:");
      
      const settlementId1 = ethers.keccak256(ethers.toUtf8Bytes("settlement_attack_1"));
      const settlementId2 = ethers.keccak256(ethers.toUtf8Bytes("settlement_attack_2"));
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes("transfer:Eve->Mallory:1000ETH"));
      const nonce = 1n;
      
      // Attacker submits first settlement
      console.log("    Attack Step 1: First settlement submission...");
      await safetyGadget.consumeNullifier(user1.address, nonce, payloadHash);
      await safetyGadget.recordSnapshot(settlementId1);
      console.log("    ✓ First settlement recorded");
      
      // Attacker tries to submit same payload again with different settlement ID
      console.log("    Attack Step 2: Attempting duplicate settlement...");
      const nullifier = await safetyGadget.computeNullifier(user1.address, nonce, payloadHash);
      
      await expect(safetyGadget.consumeNullifier(user1.address, nonce, payloadHash))
        .to.be.revertedWithCustomError(safetyGadget, "NullifierAlreadyConsumed");
      
      console.log("    🛡️  ATTACK BLOCKED! Nullifier already consumed");
      console.log("    - Nullifier:", nullifier.slice(0, 30) + "...");
    });

    it("should BLOCK premature finalization (Time-Bandit defense)", async function () {
      console.log("\n    ⚔️  TIME-BANDIT ATTACK SIMULATION:");
      
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("settlement_timebbandit"));
      
      // Record settlement
      console.log("    Attack Step 1: Recording settlement...");
      await safetyGadget.recordSnapshot(settlementId);
      
      // Attacker tries to finalize immediately (within same block or few blocks)
      console.log("    Attack Step 2: Attempting immediate finalization...");
      await mineBlocks(5);
      
      await expect(safetyGadget.verifyAncestry(settlementId))
        .to.be.revertedWithCustomError(safetyGadget, "LookbackDistanceNotMet");
      
      console.log("    🛡️  ATTACK BLOCKED! Must wait 64 blocks");
      console.log("    - This prevents miners from reorging and stealing MEV");
    });
  });
});
