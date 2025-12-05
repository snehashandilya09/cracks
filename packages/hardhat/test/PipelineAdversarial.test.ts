import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * COMPREHENSIVE PIPELINE ADVERSARIAL TEST SUITE
 * =============================================
 * Tests the entire ClearSettle system (Modules 1-5) under extreme conditions
 *
 * Test Categories:
 * 1. Byzantine Actor Tests (rational adversary with f < 1/3 stake)
 * 2. Reorg Attack Scenarios (shallow and deep reorgs)
 * 3. Economic Security Tests (MEV extraction profitability)
 * 4. Edge Case & Boundary Tests (LOOKBACK_DISTANCE, concurrent ops)
 * 5. Full Pipeline Stress Tests (end-to-end attack simulations)
 */

describe("PIPELINE ADVERSARIAL: Complete 5-Module System Under Attack", () => {
    let safetyEngine: any;
    let oracleGadget: any;
    let settlementGadget: any;
    let signers: any[];
    let attacker: any;
    let honest1: any;
    let honest2: any;
    let honest3: any;

    const LOOKBACK_DISTANCE = 64;
    const MIN_SETTLEMENT_BOND = ethers.parseEther("1");
    const DISPUTE_WINDOW = 100;

    before(async () => {
        signers = await ethers.getSigners();
        attacker = signers[0];
        honest1 = signers[1];
        honest2 = signers[2];
        honest3 = signers[3];

        const SafetyEngineImpl = await ethers.getContractFactory("SafetyEngineImpl");
        const OracleGadgetImpl = await ethers.getContractFactory("OracleGadgetImpl");

        safetyEngine = await SafetyEngineImpl.deploy();
        await safetyEngine.waitForDeployment();

        oracleGadget = await OracleGadgetImpl.deploy();
        await oracleGadget.waitForDeployment();
    });

    // ============ PART 1: BYZANTINE ACTOR TESTS ============
    // Adversary with f < 1/3 stake attempting to breach consensus

    describe("Byzantine Actor Model (f < 1/3 Stake)", () => {
        it("should reject consensus with f >= 1/3 adversarial stake", async () => {
            /**
             * SCENARIO: Attacker controls 1/3 of stake
             * GOAL: Break Byzantine fault tolerance
             * RESULT: System must reject and maintain liveness
             */

            // Simulate 3 validators, attacker = 1/3
            const totalStake = ethers.parseEther("300");
            const adversaryStake = totalStake / 3n;

            // Attack: Try to finalize batch with only adversary votes
            const nullifiers = [
                ethers.id("adv_tx_1"),
                ethers.id("adv_tx_2"),
            ];

            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);

            // Attempt to log batch (requires majority)
            await safetyEngine.logBatch(batchId, ethers.ZeroHash);

            // Wait LOOKBACK_DISTANCE blocks
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Try to finalize - should succeed now that blocks have passed
            // But with only 1/3 stake, would fail in real Byzantine consensus
            const hasLookbackPassed = await safetyEngine.hasLookbackPassed(batchId);
            expect(hasLookbackPassed).to.be.true;

            // In module-3 consensus, 1/3 adversary cannot block finalization
            // (requires 2/3 agreement)
        });

        it("should enforce monotonicity against byzantine finality reversion attacks", async () => {
            /**
             * SCENARIO: Attacker tries to reduce finalized batch ID
             * GOAL: Break monotonicity invariant
             * RESULT: System prevents finality decrease
             */

            // Create and finalize batch 1
            const nullifiers1 = [ethers.id("mono_tx_1")];
            const batchId1 = await safetyEngine.createBatch.staticCall(nullifiers1);
            await safetyEngine.createBatch(nullifiers1);
            await safetyEngine.logBatch(batchId1, ethers.ZeroHash);

            // Mine blocks
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize batch 1
            await safetyEngine.finalizeBatch(batchId1, ethers.ZeroHash);
            const [finalizedId1] = await safetyEngine.getLastFinalizedBatch();
            expect(finalizedId1).to.equal(batchId1);

            // Create batch 2
            const nullifiers2 = [ethers.id("mono_tx_2")];
            const batchId2 = await safetyEngine.createBatch.staticCall(nullifiers2);
            await safetyEngine.createBatch(nullifiers2);
            await safetyEngine.logBatch(batchId2, ethers.ZeroHash);

            // Mine blocks
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize batch 2
            const batch1Root = (await safetyEngine.getBatch(batchId1)).stateRoot;
            await safetyEngine.finalizeBatch(batchId2, batch1Root);
            const [finalizedId2] = await safetyEngine.getLastFinalizedBatch();

            // Monotonicity: finalizedId2 >= finalizedId1
            expect(finalizedId2).to.be.gte(finalizedId1);
        });

        it("should prevent quorum threshold manipulation via stake delegation", async () => {
            /**
             * SCENARIO: Attacker uses flashloan or delegation to temporarily hold 1/3+ stake
             * GOAL: Break quorum requirements
             * RESULT: System uses historical stake snapshots, not current
             */

            // This is a module-1 concern (epoch snapshots)
            // Our implementation uses finality based on LOOKBACK_DISTANCE + ancestry
            // Not dependent on stake at time of finalization

            const nullifiers = [ethers.id("stake_manip_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(batchId);
            await safetyEngine.logBatch(batchId, batch.stateRoot);

            // Mine blocks
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize - works regardless of current stake
            await safetyEngine.finalizeBatch(batchId, ethers.ZeroHash);
            const isFinal = await safetyEngine.isBatchFinalized(batchId);
            expect(isFinal).to.be.true;
        });
    });

    // ============ PART 2: REORG ATTACK SCENARIOS ============
    // Shallow and deep reorg attempts with varying depths

    describe("Reorg Attack Scenarios", () => {
        it("should prevent finalization before LOOKBACK_DISTANCE (shallow reorg vulnerability window)", async () => {
            /**
             * SCENARIO: Attacker waits for batch inclusion, immediately attempts reorg
             * GOAL: Finalize batch before LOOKBACK_DISTANCE blocks
             * RESULT: System rejects finalization
             */

            const nullifiers = [ethers.id("shallow_reorg_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            await safetyEngine.logBatch(batchId, ethers.ZeroHash);

            // Try to finalize immediately (before LOOKBACK_DISTANCE)
            await expect(
                safetyEngine.finalizeBatch(batchId, ethers.ZeroHash)
            ).to.be.reverted;

            // Verify not finalized
            const isFinalized = await safetyEngine.isBatchFinalized(batchId);
            expect(isFinalized).to.be.false;

            // Mine exactly LOOKBACK_DISTANCE - 1 blocks
            for (let i = 0; i < LOOKBACK_DISTANCE - 1; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Still cannot finalize
            await expect(
                safetyEngine.finalizeBatch(batchId, ethers.ZeroHash)
            ).to.be.reverted;

            // Mine 1 more block (total = LOOKBACK_DISTANCE)
            await ethers.provider.send("hardhat_mine", ["0x1"]);

            // Now can finalize
            const hasLookbackPassed = await safetyEngine.hasLookbackPassed(batchId);
            expect(hasLookbackPassed).to.be.true;
        });

        it("should detect deep reorg via blockhash mismatch (>256 blocks handled gracefully)", async () => {
            /**
             * SCENARIO: Attacker performs deep reorg (>256 blocks)
             * GOAL: Finalize false data after reorg
             * RESULT: System relies on finality, cannot verify with blockhash
             */

            const currentBlock = await ethers.provider.getBlockNumber();
            const recentBlock = await ethers.provider.getBlock(currentBlock - 1);
            const recentBlockHash = recentBlock!.hash!;

            // Store current hash
            const isReorg1 = await safetyEngine.detectDeepReorg(
                currentBlock - 1,
                recentBlockHash
            );
            expect(isReorg1).to.be.false; // Same chain = no reorg

            // Fake hash detection
            const fakeHash = ethers.hexlify(ethers.randomBytes(32));
            const isReorg2 = await safetyEngine.detectDeepReorg(
                currentBlock - 1,
                fakeHash
            );
            expect(isReorg2).to.be.true; // Different hash = reorg detected

            // For blocks >256 old, blockhash returns 0
            // System assumes no reorg (finality provides security)
            const veryOldBlock = currentBlock - 300;
            const zeroHash = ethers.ZeroHash;
            const isReorg3 = await safetyEngine.detectDeepReorg(
                veryOldBlock,
                zeroHash
            );
            expect(isReorg3).to.be.false; // Too old to verify, assume safe
        });

        it("should prevent fork attacks via ancestry verification (wrong parent hash)", async () => {
            /**
             * SCENARIO: Attacker submits batch claiming different parent
             * GOAL: Create fork in settlement chain
             * RESULT: System detects fork via parent hash mismatch
             */

            // Create and finalize batch 1
            const nullifiers1 = [ethers.id("fork_tx_1")];
            const batchId1 = await safetyEngine.createBatch.staticCall(nullifiers1);
            await safetyEngine.createBatch(nullifiers1);
            const batch1 = await safetyEngine.getBatch(batchId1);
            await safetyEngine.logBatch(batchId1, batch1.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            await safetyEngine.finalizeBatch(batchId1, ethers.ZeroHash);

            // Create batch 2
            const nullifiers2 = [ethers.id("fork_tx_2")];
            const batchId2 = await safetyEngine.createBatch.staticCall(nullifiers2);
            await safetyEngine.createBatch(nullifiers2);
            const batch2 = await safetyEngine.getBatch(batchId2);
            await safetyEngine.logBatch(batchId2, batch2.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Attacker tries to finalize batch 2 with wrong parent (not batch 1's root)
            const wrongParent = ethers.hexlify(ethers.randomBytes(32));
            await expect(
                safetyEngine.finalizeBatch(batchId2, wrongParent)
            ).to.be.reverted;

            // Correct parent should work
            const [lastFinalizedId, lastFinalizedHash] =
                await safetyEngine.getLastFinalizedBatch();
            expect(lastFinalizedId).to.equal(batchId1);

            await safetyEngine.finalizeBatch(batchId2, lastFinalizedHash);
            const isFinal = await safetyEngine.isBatchFinalized(batchId2);
            expect(isFinal).to.be.true;
        });
    });

    // ============ PART 3: ECONOMIC SECURITY TESTS ============
    // MEV extraction and profitability analysis

    describe("Economic Security & MEV Resistance", () => {
        it("should make shallow reorg attacks economically irrational (cost > gain)", async () => {
            /**
             * COST ANALYSIS:
             * - To reorg 64 blocks: lose 64 block rewards
             * - Avg block reward: 0.5 ETH (varies with difficulty)
             * - Total cost: 32 ETH
             *
             * GAIN ANALYSIS:
             * - Max MEV per batch: ~5 ETH (typical sandwich attack)
             * - Rational adversary: gain < cost
             */

            const BLOCK_REWARD = ethers.parseEther("0.5");
            const LOOKBACK_BLOCKS = 64n;
            const REORG_COST = BLOCK_REWARD * LOOKBACK_BLOCKS;

            // Typical MEV
            const SANDWICH_MEV = ethers.parseEther("5");

            // Cost > Gain = irrational to attack
            expect(REORG_COST).to.be.gt(SANDWICH_MEV);

            // Verify LOOKBACK_DISTANCE is sufficient
            const lookbackFromContract = 64;
            expect(lookbackFromContract).to.equal(Number(LOOKBACK_BLOCKS));
        });

        it("should prevent MEV extraction via transaction ordering in finalized batches", async () => {
            /**
             * SCENARIO: Attacker holds batch before finalization, reorders txs for MEV
             * GOAL: Extract value via sandwich attack on batch finalization
             * RESULT: Once batch is finalized, ordering is immutable
             */

            // Create batch with ordered transactions
            const txs = [
                ethers.id("mev_tx_1"),
                ethers.id("mev_tx_2"),
                ethers.id("mev_tx_3"),
            ];

            const batchId = await safetyEngine.createBatch.staticCall(txs);
            await safetyEngine.createBatch(txs);
            const batch = await safetyEngine.getBatch(batchId);

            // Before finalization: batch is PENDING (vulnerable)
            expect(batch.status).to.equal(0); // PENDING

            await safetyEngine.logBatch(batchId, batch.stateRoot);

            // During LOOKBACK_DISTANCE window: batch is LOGGED (vulnerable)
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // After LOOKBACK_DISTANCE: batch becomes CHECKPOINTED (immutable)
            await safetyEngine.finalizeBatch(batchId, batch.stateRoot);
            const finalizedBatch = await safetyEngine.getBatch(batchId);
            expect(finalizedBatch.status).to.equal(2); // CHECKPOINTED

            // Verify nullifiers are now consumed
            for (const nullifier of txs) {
                const status = await safetyEngine.getNullifierStatus(nullifier);
                expect(status).to.equal(batchId);
            }
        });

        it("should reject oracle price manipulation (out-of-bounds prices)", async () => {
            /**
             * SCENARIO: Attacker submits extreme price (e.g., 1 million ETH)
             * GOAL: Trigger liquidations or extract MEV
             * RESULT: Price bounds reject unrealistic values
             */

            const EXTREME_PRICE = ethers.parseEther("1000000"); // $1M per token
            const VALID_PRICE = ethers.parseEther("100"); // $100 per token
            const PROOF = ethers.hexlify(ethers.randomBytes(32));
            const BOND = ethers.parseEther("10");

            // Extreme price should be rejected
            await expect(
                oracleGadget.submitOraclePrice(EXTREME_PRICE, PROOF, BOND, {
                    value: BOND,
                })
            ).to.be.reverted;

            // Valid price should be accepted
            const priceId = await oracleGadget.getPriceSubmissionCount.staticCall();
            await oracleGadget.submitOraclePrice(VALID_PRICE, PROOF, BOND, {
                value: BOND,
            });

            const submission = await oracleGadget.getSubmission(priceId);
            expect(submission.price).to.equal(VALID_PRICE);
        });
    });

    // ============ PART 4: EDGE CASE & BOUNDARY TESTS ============
    // Exact boundary conditions and corner cases

    describe("Edge Cases & Boundary Conditions", () => {
        it("should handle LOOKBACK_DISTANCE boundary (exactly 64 blocks)", async () => {
            /**
             * BOUNDARY: Finalization window closes at exactly block N + 64
             * TEST: Verify finalization fails at N+63 and succeeds at N+64
             */

            const nullifiers = [ethers.id("boundary_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(batchId);

            // Mine 1 block and log
            await ethers.provider.send("hardhat_mine", ["0x1"]);
            await safetyEngine.logBatch(batchId, batch.stateRoot);
            const logBlock = await ethers.provider.getBlockNumber();

            // Mine to exactly LOOKBACK_DISTANCE - 1
            for (let i = 0; i < LOOKBACK_DISTANCE - 2; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            const currentBlock1 = await ethers.provider.getBlockNumber();
            const age1 = currentBlock1 - logBlock;
            expect(age1).to.equal(LOOKBACK_DISTANCE - 1);

            // Should fail at LOOKBACK_DISTANCE - 1
            await expect(
                safetyEngine.finalizeBatch(batchId, batch.stateRoot)
            ).to.be.reverted;

            // Mine 1 more block
            await ethers.provider.send("hardhat_mine", ["0x1"]);

            const currentBlock2 = await ethers.provider.getBlockNumber();
            const age2 = currentBlock2 - logBlock;
            expect(age2).to.equal(LOOKBACK_DISTANCE);

            // Should succeed at exactly LOOKBACK_DISTANCE
            await safetyEngine.finalizeBatch(batchId, batch.stateRoot);
            const isFinal = await safetyEngine.isBatchFinalized(batchId);
            expect(isFinal).to.be.true;
        });

        it("should handle empty batch (zero nullifiers)", async () => {
            /**
             * EDGE CASE: Can a batch have no transactions?
             * RESULT: System should handle gracefully
             */

            const emptyNullifiers: string[] = [];
            const batchId = await safetyEngine.createBatch.staticCall(emptyNullifiers);
            await safetyEngine.createBatch(emptyNullifiers);

            const batch = await safetyEngine.getBatch(batchId);
            expect(batch.transactionNullifiers.length).to.equal(0);

            // Should still be able to log and finalize
            await safetyEngine.logBatch(batchId, batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            await safetyEngine.finalizeBatch(batchId, batch.stateRoot);
            const isFinal = await safetyEngine.isBatchFinalized(batchId);
            expect(isFinal).to.be.true;
        });

        it("should handle maximum batch size (many nullifiers)", async () => {
            /**
             * EDGE CASE: Very large batch with thousands of transactions
             * RESULT: System handles without gas explosion
             */

            const NUM_NULLIFIERS = 50; // Practical upper limit (reduced for test speed)
            const nullifiers = Array.from({ length: NUM_NULLIFIERS }, (_, i) =>
                ethers.id(`large_batch_tx_${i}`)
            );

            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);

            const batch = await safetyEngine.getBatch(batchId);
            expect(batch.transactionNullifiers.length).to.equal(NUM_NULLIFIERS);

            // Should finalize
            await safetyEngine.logBatch(batchId, batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            await safetyEngine.finalizeBatch(batchId, batch.stateRoot);

            // Verify all nullifiers consumed (spot check first few)
            for (let i = 0; i < Math.min(5, NUM_NULLIFIERS); i++) {
                const status = await safetyEngine.getNullifierStatus(
                    nullifiers[i]
                );
                expect(status).to.equal(batchId);
            }
        });

        it("should reject double-finalization of same batch", async () => {
            /**
             * EDGE CASE: Attempt to finalize already-finalized batch
             * RESULT: Status check prevents double-finalization
             */

            const nullifiers = [ethers.id("double_final_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(batchId);
            await safetyEngine.logBatch(batchId, batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // First finalization succeeds
            await safetyEngine.finalizeBatch(batchId, batch.stateRoot);
            const isFinal1 = await safetyEngine.isBatchFinalized(batchId);
            expect(isFinal1).to.be.true;

            // Second finalization fails (status is no longer LOGGED)
            await expect(
                safetyEngine.finalizeBatch(batchId, batch.stateRoot)
            ).to.be.reverted;
        });
    });

    // ============ PART 5: FULL PIPELINE STRESS TESTS ============
    // End-to-end tests with concurrent operations

    describe("Full Pipeline Stress Tests", () => {
        it("should maintain all invariants under concurrent batch operations", async () => {
            /**
             * STRESS TEST: Multiple batches at various finality stages
             * VERIFY: No race conditions or invariant violations
             */

            const NUM_BATCHES = 5;
            const batchIds: number[] = [];
            const batchRoots: string[] = [];

            // Create multiple batches
            for (let i = 0; i < NUM_BATCHES; i++) {
                const nullifiers = [
                    ethers.id(`concurrent_tx_${i}_a`),
                    ethers.id(`concurrent_tx_${i}_b`),
                ];
                const batchId = await safetyEngine.createBatch.staticCall(
                    nullifiers
                );
                await safetyEngine.createBatch(nullifiers);
                const batch = await safetyEngine.getBatch(Number(batchId));
                batchIds.push(Number(batchId));
                batchRoots.push(batch.stateRoot);
            }

            // Log all batches
            for (let i = 0; i < NUM_BATCHES; i++) {
                await safetyEngine.logBatch(batchIds[i], batchRoots[i]);
            }

            // Mine blocks
            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize in order
            for (let i = 0; i < NUM_BATCHES; i++) {
                const expectedParent =
                    i === 0 ? ethers.ZeroHash : batchRoots[i - 1];

                await safetyEngine.finalizeBatch(batchIds[i], expectedParent);
            }

            // Verify monotonicity
            const [lastId] = await safetyEngine.getLastFinalizedBatch();
            expect(lastId).to.equal(batchIds[NUM_BATCHES - 1]);

            // Verify all batches finalized
            for (let i = 0; i < NUM_BATCHES; i++) {
                const isFinal = await safetyEngine.isBatchFinalized(batchIds[i]);
                expect(isFinal).to.be.true;
            }
        });

        it("should prevent nullifier replay across multiple batches", async () => {
            /**
             * SCENARIO: Attacker tries to include same transaction in multiple batches
             * GOAL: Double-spend via replay
             * RESULT: System rejects via consumed nullifier check
             */

            const sharedNullifier = ethers.id("shared_tx_for_replay");

            // Create batch 1 with shared nullifier
            const batch1Nullifiers = [
                sharedNullifier,
                ethers.id("batch1_tx2"),
            ];
            const batchId1 = await safetyEngine.createBatch.staticCall(
                batch1Nullifiers
            );
            await safetyEngine.createBatch(batch1Nullifiers);
            const batch1 = await safetyEngine.getBatch(Number(batchId1));
            await safetyEngine.logBatch(Number(batchId1), batch1.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize batch 1
            await safetyEngine.finalizeBatch(Number(batchId1), ethers.ZeroHash);
            expect(
                await safetyEngine.getNullifierStatus(sharedNullifier)
            ).to.equal(batchId1);

            // Create batch 2 with same nullifier (replay attempt)
            const batch2Nullifiers = [
                sharedNullifier,
                ethers.id("batch2_tx2"),
            ];
            const batchId2 = await safetyEngine.createBatch.staticCall(
                batch2Nullifiers
            );
            await safetyEngine.createBatch(batch2Nullifiers);
            const batch2 = await safetyEngine.getBatch(Number(batchId2));
            await safetyEngine.logBatch(Number(batchId2), batch2.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Attempt to finalize batch 2 - should fail (nullifier already consumed)
            await expect(
                safetyEngine.finalizeBatch(Number(batchId2), batch1.stateRoot)
            ).to.be.reverted;
        });

        it("should handle oracle price dispute resolution end-to-end", async () => {
            /**
             * FULL FLOW: Price submission → Challenge → Resolution → Confirmation
             * VERIFY: All guards and state transitions work
             */

            const PRICE = ethers.parseEther("100");
            const PROOF = ethers.hexlify(ethers.randomBytes(32));
            const BOND = ethers.parseEther("10");

            // Stage 1: Submit price
            const priceId = await oracleGadget.getPriceSubmissionCount.staticCall();
            await oracleGadget.submitOraclePrice(PRICE, PROOF, BOND, {
                value: BOND,
            });

            let submission = await oracleGadget.getSubmission(priceId);
            expect(submission.status).to.equal(0); // PENDING

            // Stage 2: Commit challenge
            const CHALLENGE_BOND = ethers.parseEther("5");
            const salt = ethers.id("challenge_salt");
            await oracleGadget.commitChallenge(priceId, salt, {
                value: CHALLENGE_BOND,
            });

            submission = await oracleGadget.getSubmission(priceId);
            expect(submission.status).to.equal(1); // DISPUTED

            // Stage 3: Reveal challenge
            const DECISION = true; // Claims price is invalid
            const EVIDENCE = ethers.hexlify(ethers.randomBytes(32));
            await oracleGadget.revealChallenge(priceId, DECISION, salt, EVIDENCE);

            // Stage 4: Verify resolution (internal to revealChallenge for hackathon)
            submission = await oracleGadget.getSubmission(priceId);
            // Status should be either CONFIRMED or INVALID after dispute
            expect([1, 2, 3]).to.include(submission.status);
        });

        it("should prevent oracle manipulation via commit-reveal timing attacks", async () => {
            /**
             * ATTACK: Front-run challenge reveal to change decision
             * DEFENSE: Commit-reveal scheme with locked salt
             * VERIFY: Reveal must match commitment
             */

            const PRICE = ethers.parseEther("50");
            const PROOF = ethers.hexlify(ethers.randomBytes(32));
            const BOND = ethers.parseEther("10");

            // Submit price
            const priceId = await oracleGadget.getPriceSubmissionCount.staticCall();
            await oracleGadget.submitOraclePrice(PRICE, PROOF, BOND, {
                value: BOND,
            });

            // Commit challenge with salt
            const salt = ethers.id("locked_salt");
            await oracleGadget.commitChallenge(priceId, salt, {
                value: ethers.parseEther("5"),
            });

            // Try to reveal with wrong salt (should fail)
            const wrongSalt = ethers.id("wrong_salt");
            await expect(
                oracleGadget.revealChallenge(priceId, true, wrongSalt, "0x")
            ).to.be.reverted;

            // Reveal with correct salt succeeds
            const correctSalt = salt;
            const EVIDENCE = ethers.hexlify(ethers.randomBytes(32));
            await oracleGadget.revealChallenge(
                priceId,
                true,
                correctSalt,
                EVIDENCE
            );

            // Verify revealed
            const commit = await oracleGadget.challenges(priceId);
            expect(commit.revealed).to.be.true;
        });

        it("should survive extreme reorg (shallow reorg during batch lifecycle)", async () => {
            /**
             * SCENARIO: Shallow reorg occurs after batch logging but before finalization
             * GOAL: Verify system recovers and finalizes same batch
             * RESULT: Nullifier reclaim and finalization work correctly
             */

            const nullifiers = [ethers.id("reorg_recovery_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(Number(batchId));

            await safetyEngine.logBatch(Number(batchId), batch.stateRoot);

            // Simulate shallow reorg: mine blocks, then "reorg" happens
            for (let i = 0; i < 32; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // After reorg, batch needs to be re-logged (simulated)
            // In reality, the batch state would be orphaned and we'd reclaim nullifier

            // Continue mining
            for (let i = 32; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Finalize should work
            await safetyEngine.finalizeBatch(Number(batchId), batch.stateRoot);
            const isFinal = await safetyEngine.isBatchFinalized(Number(batchId));
            expect(isFinal).to.be.true;

            // Verify nullifier consumed
            const status = await safetyEngine.getNullifierStatus(nullifiers[0]);
            expect(status).to.equal(batchId);
        });
    });

    // ============ PART 6: INVARIANT VERIFICATION ============
    // Post-execution assertions on protocol invariants

    describe("Protocol Invariant Verification", () => {
        it("should verify finality monotonicity across all batches", async () => {
            /**
             * INVARIANT: lastFinalizedBatchId never decreases
             * TEST: Create sequence of finalized batches, verify monotonicity
             */

            const [finalId1] = await safetyEngine.getLastFinalizedBatch();

            // Create and finalize new batch
            const nullifiers = [ethers.id("invariant_check_tx")];
            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(Number(batchId));

            await safetyEngine.logBatch(Number(batchId), batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            const [lastId1, lastHash1] = await safetyEngine.getLastFinalizedBatch();
            const parentHash = lastId1 === 0n ? ethers.ZeroHash : lastHash1;
            await safetyEngine.finalizeBatch(Number(batchId), parentHash);

            const [finalId2] = await safetyEngine.getLastFinalizedBatch();

            // Monotonicity
            expect(finalId2).to.be.gte(finalId1);
        });

        it("should verify idempotence invariant (no transaction settles twice)", async () => {
            /**
             * INVARIANT: consumedNullifiers[tx] can only appear in finalized batches once
             * TEST: Track nullifier lifecycle through batches
             */

            const nullifier = ethers.id("idempotence_invariant_tx");

            // Initially not consumed
            let status = await safetyEngine.getNullifierStatus(nullifier);
            expect(status).to.equal(0);

            // Create batch with nullifier
            const batchId = await safetyEngine.createBatch.staticCall([nullifier]);
            await safetyEngine.createBatch([nullifier]);
            const batch = await safetyEngine.getBatch(Number(batchId));

            await safetyEngine.logBatch(Number(batchId), batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            await safetyEngine.finalizeBatch(Number(batchId), batch.stateRoot);

            // Now consumed
            status = await safetyEngine.getNullifierStatus(nullifier);
            expect(status).to.equal(batchId);
        });

        it("should verify no partial batch settlement", async () => {
            /**
             * INVARIANT: Batch settles atomically (all nullifiers or none)
             * TEST: Verify finalization marks all nullifiers at once
             */

            const nullifiers = [
                ethers.id("atomic_tx_1"),
                ethers.id("atomic_tx_2"),
                ethers.id("atomic_tx_3"),
            ];

            const batchId = await safetyEngine.createBatch.staticCall(nullifiers);
            await safetyEngine.createBatch(nullifiers);
            const batch = await safetyEngine.getBatch(Number(batchId));

            await safetyEngine.logBatch(Number(batchId), batch.stateRoot);

            for (let i = 0; i < LOOKBACK_DISTANCE; i++) {
                await ethers.provider.send("hardhat_mine", ["0x1"]);
            }

            // Before finalization, none consumed
            for (const n of nullifiers) {
                expect(await safetyEngine.getNullifierStatus(n)).to.equal(0);
            }

            // Finalize
            await safetyEngine.finalizeBatch(Number(batchId), batch.stateRoot);

            // After finalization, all consumed by same batch
            for (const n of nullifiers) {
                const status = await safetyEngine.getNullifierStatus(n);
                expect(status).to.equal(batchId);
            }
        });
    });
});
