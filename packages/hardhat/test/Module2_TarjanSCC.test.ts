import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║         MODULE-2: TARJAN'S SCC ALGORITHM TEST SUITE                       ║
 * ║                                                                            ║
 * ║  Tests for Tarjan's SCC implementation and condensation graph             ║
 * ║                                                                            ║
 * ║  TEST CATEGORIES:                                                          ║
 * ║  1. Tarjan's Algorithm (SCC Detection with Cycles)                        ║
 * ║  2. Condensation Graph (DAG of SCCs)                                      ║
 * ║  3. Topological Sort (Final Ordering)                                     ║
 * ║  4. Complex Scenarios (Multiple Cycles, Diamond Patterns)                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

describe("Module-2: Tarjan's SCC Algorithm & Condensation Graph", function () {

  /**
   * Test Scenario 1: Simple Cycle (A → B → C → A)
   *
   * Network Latency Scenario:
   * - Validator 1 sees: A, B, C
   * - Validator 2 sees: B, C, A
   * - Validator 3 sees: C, A, B
   *
   * This creates a cycle where no transaction clearly precedes another.
   * Tarjan's algorithm should detect this as a single SCC containing [A, B, C].
   */
  it("should detect simple cycle (A → B → C → A) as single SCC", async function () {
    // Create transaction hashes
    const txA = ethers.id("transaction_A");
    const txB = ethers.id("transaction_B");
    const txC = ethers.id("transaction_C");

    const txHashes = [txA, txB, txC];

    // Build dependency edges (forming a cycle)
    // A → B (2/3 validators saw A before B)
    // B → C (2/3 validators saw B before C)
    // C → A (2/3 validators saw C before A)
    const edges = [
      { fromTx: txA, toTx: txB, supportCount: 2, enforced: true },
      { fromTx: txB, toTx: txC, supportCount: 2, enforced: true },
      { fromTx: txC, toTx: txA, supportCount: 2, enforced: true }
    ];

    // Deploy a test contract to call Aequitas library
    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    // Call findStronglyConnectedComponents
    const batches = await testContract.testFindSCCs(txHashes, edges);

    // Verify: Should return 1 SCC containing all 3 transactions
    expect(batches.length).to.equal(1, "Should detect 1 SCC for simple cycle");
    expect(batches[0].transactions.length).to.equal(3, "SCC should contain all 3 transactions");

    // Verify transactions are in the SCC
    const sccTxs = batches[0].transactions;
    expect(sccTxs).to.include(txA);
    expect(sccTxs).to.include(txB);
    expect(sccTxs).to.include(txC);

    console.log("✅ Detected cycle: [A, B, C] form single atomic batch");
  });

  /**
   * Test Scenario 2: No Cycles (A → B → C)
   *
   * Network Latency Scenario:
   * - All validators consistently see: A, then B, then C
   *
   * This creates a linear dependency graph with no cycles.
   * Tarjan's algorithm should detect 3 separate SCCs: [A], [B], [C].
   */
  it("should detect no cycles (A → B → C) as 3 separate SCCs", async function () {
    const txA = ethers.id("transaction_A");
    const txB = ethers.id("transaction_B");
    const txC = ethers.id("transaction_C");

    const txHashes = [txA, txB, txC];

    // Build linear dependency edges (no cycles)
    // A → B (all validators saw A before B)
    // B → C (all validators saw B before C)
    const edges = [
      { fromTx: txA, toTx: txB, supportCount: 3, enforced: true },
      { fromTx: txB, toTx: txC, supportCount: 3, enforced: true }
    ];

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    const batches = await testContract.testFindSCCs(txHashes, edges);

    // Verify: Should return 3 SCCs, each containing 1 transaction
    expect(batches.length).to.equal(3, "Should detect 3 separate SCCs (no cycles)");

    batches.forEach((batch, idx) => {
      expect(batch.transactions.length).to.equal(1, `SCC ${idx} should contain 1 transaction`);
    });

    console.log("✅ No cycles detected: [A], [B], [C] as separate SCCs");
  });

  /**
   * Test Scenario 3: Multiple SCCs with Dependencies
   *
   * Dependency Graph:
   * - SCC1: (A → B → A)  - cycle between A and B
   * - SCC2: [C]           - single transaction
   * - SCC3: (D → E → D)  - cycle between D and E
   * - Cross-SCC edges: SCC1 → SCC2 → SCC3
   *
   * Expected: 3 SCCs, topologically sorted as [SCC1, SCC2, SCC3]
   */
  it("should detect multiple SCCs with dependencies", async function () {
    const txA = ethers.id("tx_A");
    const txB = ethers.id("tx_B");
    const txC = ethers.id("tx_C");
    const txD = ethers.id("tx_D");
    const txE = ethers.id("tx_E");

    const txHashes = [txA, txB, txC, txD, txE];

    // Build complex dependency graph
    const edges = [
      // Cycle 1: A ⇄ B
      { fromTx: txA, toTx: txB, supportCount: 2, enforced: true },
      { fromTx: txB, toTx: txA, supportCount: 2, enforced: true },

      // C is independent
      { fromTx: txA, toTx: txC, supportCount: 3, enforced: true }, // SCC1 → C
      { fromTx: txB, toTx: txC, supportCount: 3, enforced: true }, // SCC1 → C

      // Cycle 2: D ⇄ E
      { fromTx: txD, toTx: txE, supportCount: 2, enforced: true },
      { fromTx: txE, toTx: txD, supportCount: 2, enforced: true },

      // Cross-SCC edge: C → SCC2
      { fromTx: txC, toTx: txD, supportCount: 3, enforced: true },
      { fromTx: txC, toTx: txE, supportCount: 3, enforced: true }
    ];

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    const batches = await testContract.testFindSCCs(txHashes, edges);

    // Verify: Should detect 3 SCCs
    expect(batches.length).to.equal(3, "Should detect 3 SCCs");

    // Find which batch contains which transactions
    let scc1 = batches.find(b => b.transactions.includes(txA));
    let scc2 = batches.find(b => b.transactions.includes(txC));
    let scc3 = batches.find(b => b.transactions.includes(txD));

    expect(scc1).to.not.be.undefined;
    expect(scc2).to.not.be.undefined;
    expect(scc3).to.not.be.undefined;

    // Verify SCC1 contains A and B (cycle)
    expect(scc1!.transactions.length).to.equal(2);
    expect(scc1!.transactions).to.include(txA);
    expect(scc1!.transactions).to.include(txB);

    // Verify SCC2 contains C only
    expect(scc2!.transactions.length).to.equal(1);
    expect(scc2!.transactions[0]).to.equal(txC);

    // Verify SCC3 contains D and E (cycle)
    expect(scc3!.transactions.length).to.equal(2);
    expect(scc3!.transactions).to.include(txD);
    expect(scc3!.transactions).to.include(txE);

    console.log("✅ Multiple SCCs detected correctly:");
    console.log(`   SCC1: [A, B] (cycle)`);
    console.log(`   SCC2: [C] (singleton)`);
    console.log(`   SCC3: [D, E] (cycle)`);
  });

  /**
   * Test Scenario 4: Diamond Pattern (Condorcet Paradox)
   *
   * Dependency Graph:
   *     A
   *    / \
   *   B   C
   *    \ /
   *     D
   *
   * With conflicting paths creating subtle cycles.
   * This tests the robustness of Tarjan's algorithm.
   */
  it("should handle diamond pattern correctly", async function () {
    const txA = ethers.id("tx_A");
    const txB = ethers.id("tx_B");
    const txC = ethers.id("tx_C");
    const txD = ethers.id("tx_D");

    const txHashes = [txA, txB, txC, txD];

    // Diamond pattern
    const edges = [
      { fromTx: txA, toTx: txB, supportCount: 3, enforced: true },
      { fromTx: txA, toTx: txC, supportCount: 3, enforced: true },
      { fromTx: txB, toTx: txD, supportCount: 3, enforced: true },
      { fromTx: txC, toTx: txD, supportCount: 3, enforced: true }
    ];

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    const batches = await testContract.testFindSCCs(txHashes, edges);

    // Verify: Diamond with no cycles should create 4 separate SCCs
    expect(batches.length).to.equal(4, "Diamond pattern should create 4 SCCs");

    console.log("✅ Diamond pattern handled: 4 separate SCCs");
  });

  /**
   * Test Scenario 5: Topological Sort of SCCs
   *
   * After detecting SCCs, the condensation graph must be topologically sorted.
   * This ensures final execution order respects dependencies.
   *
   * Dependency: SCC1 → SCC2 → SCC3
   * Expected order: [SCC1, SCC2, SCC3]
   */
  it("should topologically sort SCCs correctly", async function () {
    const txA = ethers.id("tx_A");
    const txB = ethers.id("tx_B");
    const txC = ethers.id("tx_C");

    const txHashes = [txA, txB, txC];

    // Linear dependency
    const edges = [
      { fromTx: txA, toTx: txB, supportCount: 3, enforced: true },
      { fromTx: txB, toTx: txC, supportCount: 3, enforced: true }
    ];

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    // Get both SCCs and sorted result
    const sccs = await testContract.testFindSCCs(txHashes, edges);
    const sortedBatches = await testContract.testTopologicalSort(sccs, edges, txHashes);

    // Verify: Order should be A, B, C
    expect(sortedBatches.length).to.equal(3);
    expect(sortedBatches[0].transactions[0]).to.equal(txA, "First batch should contain A");
    expect(sortedBatches[1].transactions[0]).to.equal(txB, "Second batch should contain B");
    expect(sortedBatches[2].transactions[0]).to.equal(txC, "Third batch should contain C");

    // Verify batch indices are sequential
    expect(sortedBatches[0].batchIndex).to.equal(0);
    expect(sortedBatches[1].batchIndex).to.equal(1);
    expect(sortedBatches[2].batchIndex).to.equal(2);

    console.log("✅ Topological sort correct: A → B → C");
  });

  /**
   * Test Scenario 6: Large Cycle (Stress Test)
   *
   * Test with 10 transactions forming a single cycle.
   * This tests scalability of Tarjan's algorithm.
   */
  it("should handle large cycle (10 transactions)", async function () {
    // Create 10 transaction hashes
    const txCount = 10;
    const txHashes = [];

    for (let i = 0; i < txCount; i++) {
      txHashes.push(ethers.id(`tx_${i}`));
    }

    // Create cycle: tx0 → tx1 → tx2 → ... → tx9 → tx0
    const edges = [];
    for (let i = 0; i < txCount; i++) {
      const from = txHashes[i];
      const to = txHashes[(i + 1) % txCount];
      edges.push({ fromTx: from, toTx: to, supportCount: 2, enforced: true });
    }

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    const batches = await testContract.testFindSCCs(txHashes, edges);

    // Verify: Should detect 1 large SCC
    expect(batches.length).to.equal(1, "Should detect 1 SCC for 10-tx cycle");
    expect(batches[0].transactions.length).to.equal(10, "SCC should contain all 10 transactions");

    console.log("✅ Large cycle handled: 10 transactions in single SCC");
  });

  /**
   * Test Scenario 7: Deterministic Tie-Breaking
   *
   * When multiple SCCs have zero in-degree, topological sort must
   * use deterministic tie-breaking (hash-based) to ensure reproducibility.
   */
  it("should use deterministic tie-breaking in topological sort", async function () {
    const txA = ethers.id("tx_A");
    const txB = ethers.id("tx_B");
    const txC = ethers.id("tx_C");

    const txHashes = [txA, txB, txC];

    // No edges - all are independent (3 zero in-degree nodes)
    const edges: any[] = [];

    const TestAequitas = await ethers.getContractFactory("TestAequitasHarness");
    const testContract = await TestAequitas.deploy();
    await testContract.waitForDeployment();

    const sccs = await testContract.testFindSCCs(txHashes, edges);
    const sorted1 = await testContract.testTopologicalSort(sccs, edges, txHashes);
    const sorted2 = await testContract.testTopologicalSort(sccs, edges, txHashes);

    // Verify: Two calls produce identical ordering
    expect(sorted1.length).to.equal(sorted2.length);

    for (let i = 0; i < sorted1.length; i++) {
      expect(sorted1[i].transactions[0]).to.equal(
        sorted2[i].transactions[0],
        "Tie-breaking must be deterministic"
      );
    }

    console.log("✅ Deterministic tie-breaking verified");
  });
});
