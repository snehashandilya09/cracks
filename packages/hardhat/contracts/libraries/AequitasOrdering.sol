// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IClearSettle.sol";

/**
 * @title AequitasOrdering
 * @author ClearSettle Team - TriHacker Tournament Finale Module 2
 * @notice Implements fair ordering via Aequitas algorithm
 * @dev Prevents MEV, Time-Bandit attacks, and Priority Gas Auctions
 *
 * AEQUITAS ALGORITHM (Module-2 Section 3):
 * ==========================================
 *
 * Stage I: Blind Ingestion (Mempool)
 *   - Users submit commitment hashes
 *   - Validators track reception timestamps
 *   - Output: Reception logs with all validator timestamps
 *
 * Stage II: Fair Sequencing (Aequitas)
 *   - Build dependency graph based on receive times
 *   - Apply fairness threshold (gamma * n validators must see A before B)
 *   - Detect cycles (SCCs) from network latency
 *   - Collapse cycles into Atomic Batches
 *   - Topologically sort for final ordering
 *   - Output: Linear sequence of Atomic Batches
 *
 * SECURITY GUARANTEES:
 * ===================
 * 1. Time-Bandit Resistance: Attacker needs > gamma*n validator nodes to reorder
 * 2. PGA Resistance: Ordering ignores gas price (reception time only)
 * 3. Fair Ordering: All transactions ordered by reception time consensus
 */
library AequitasOrdering {

    // ============ Events ============

    event DependencyGraphBuilt(
        uint256 indexed epochId,
        uint256 txCount,
        uint256 edgeCount,
        uint256 timestamp
    );

    event CyclesResolved(
        uint256 indexed epochId,
        uint256 sccCount,
        uint256 atomicBatchesCreated
    );

    event FairnessParameterApplied(
        uint256 gamma,
        uint256 totalValidators,
        uint256 threshold
    );

    // ============ Constants ============

    // Fairness parameter: gamma * n validators must see A before B
    // For demo: gamma = 1.0 (unanimous) -> n > 2f (simple majority for 1 byzantine)
    uint256 constant GAMMA_NUMERATOR = 100;   // Represents gamma as percentage
    uint256 constant GAMMA_DENOMINATOR = 100; // 100% = unanimous

    // ============ Stage I: Reception Log Tracking ============

    /**
     * @notice Track that a validator received a transaction
     * @param receptionLogs Mapping of tx hash to reception log
     * @param txHash Hash of transaction received
     * @param validator Address of validator who received it
     * @param timestamp Block number when received
     *
     * SECURITY: Multiple validators submit their receive times
     * This creates a consensus on ordering that's resistant to manipulation
     */
    function recordReception(
        mapping(bytes32 => ReceptionLog) storage receptionLogs,
        bytes32 txHash,
        address validator,
        uint256 timestamp
    ) internal {
        ReceptionLog storage log = receptionLogs[txHash];

        // Initialize if first time seeing this tx
        if (log.timestamps.length == 0) {
            log.txHash = txHash;
        }

        // Add this validator's timestamp
        log.timestamps.push(ValidatorTimestamp({
            validator: validator,
            timestamp: timestamp
        }));
    }

    // ============ Stage II: Aequitas Dependency Graph ============

    /**
     * @notice Build dependency graph based on fair ordering
     * @param txHashes Array of transaction hashes to order
     * @param receptionLogs Reception logs from all validators
     * @param validatorCount Total number of validators (n)
     * @return edges Dependency edges that establish ordering
     *
     * ALGORITHM (Module-2 Section 3.1):
     * For each pair (Tx_A, Tx_B):
     *   count = # of validators who saw Tx_A before Tx_B
     *   if count >= (gamma * n):
     *       add edge Tx_A -> Tx_B
     *
     * SECURITY: Prevents reordering by requiring consensus from gamma*n validators
     * TIME-BANDIT RESISTANCE: Attacker can't create edge Tx_arb -> Tx_user
     * unless they control > gamma*n validator nodes
     */
    function buildDependencyGraph(
        bytes32[] memory txHashes,
        mapping(bytes32 => ReceptionLog) storage receptionLogs,
        uint256 validatorCount
    ) internal view returns (DependencyEdge[] memory edges) {
        // Calculate fairness threshold
        // threshold = ceil((GAMMA_NUMERATOR * validatorCount) / GAMMA_DENOMINATOR)
        uint256 threshold = (GAMMA_NUMERATOR * validatorCount + GAMMA_DENOMINATOR - 1)
                            / GAMMA_DENOMINATOR;

        uint256 edgeCount = 0;
        DependencyEdge[] memory allEdges = new DependencyEdge[](txHashes.length * (txHashes.length - 1));

        // For each pair of transactions
        for (uint256 i = 0; i < txHashes.length; i++) {
            for (uint256 j = 0; j < txHashes.length; j++) {
                if (i == j) continue;

                bytes32 txA = txHashes[i];
                bytes32 txB = txHashes[j];

                // Count validators who saw A before B
                uint256 supportCount = countValidatorsSeeingFirst(
                    receptionLogs[txA].timestamps,
                    receptionLogs[txB].timestamps
                );

                // APPLY AEQUITAS LOGIC: if threshold met, enforce edge
                if (supportCount >= threshold) {
                    allEdges[edgeCount] = DependencyEdge({
                        fromTx: txA,
                        toTx: txB,
                        supportCount: supportCount,
                        enforced: true
                    });
                    edgeCount++;
                }
            }
        }

        // Return only the edges that were created
        edges = new DependencyEdge[](edgeCount);
        for (uint256 i = 0; i < edgeCount; i++) {
            edges[i] = allEdges[i];
        }

        return edges;
    }

    /**
     * @notice Count validators who saw txA before txB
     * @param timestampsA Reception timestamps for tx A
     * @param timestampsB Reception timestamps for tx B
     * @return count Number of validators who saw A first
     */
    function countValidatorsSeeingFirst(
        ValidatorTimestamp[] storage timestampsA,
        ValidatorTimestamp[] storage timestampsB
    ) internal view returns (uint256 count) {
        // For each validator's A timestamp, check if they saw B later
        for (uint256 i = 0; i < timestampsA.length; i++) {
            address validatorA = timestampsA[i].validator;
            uint256 timeA = timestampsA[i].timestamp;

            // Find same validator in B's timestamps
            for (uint256 j = 0; j < timestampsB.length; j++) {
                if (timestampsB[j].validator == validatorA) {
                    uint256 timeB = timestampsB[j].timestamp;
                    if (timeA < timeB) {
                        count++;
                    }
                    break;
                }
            }
        }
    }

    // ============ Stage II: Cycle Resolution (Tarjan's SCC) ============

    /**
     * @notice Find Strongly Connected Components (SCCs) using Tarjan's algorithm
     * @dev SCCs represent cycles in the dependency graph
     *      Transactions in same SCC are "simultaneous" (partial finality)
     *
     * TARJAN'S ALGORITHM (Module-2 Section 3.2):
     * ===========================================
     * 1. DFS traversal with discovery time tracking
     * 2. Maintain stack of visited nodes
     * 3. Track lowlink values (earliest reachable ancestor)
     * 4. When lowlink[v] == disc[v], found SCC root
     * 5. Pop stack to collect SCC members
     *
     * COMPLEXITY: O(V + E) where V = transactions, E = edges
     * GAS OPTIMIZATION: For large batches, compute off-chain and submit proof
     *
     * @param txHashes Array of transaction hashes to analyze
     * @param edges Dependency edges from BuildDependencyGraph
     * @return batches Array of Atomic Batches (one per SCC)
     */
    function findStronglyConnectedComponents(
        bytes32[] memory txHashes,
        DependencyEdge[] memory edges
    ) internal pure returns (AtomicBatch[] memory batches) {
        uint256 n = txHashes.length;

        if (n == 0) {
            return new AtomicBatch[](0);
        }

        // Build adjacency list from edges
        TarjanState memory state = initializeTarjanState(txHashes, edges);

        // Run Tarjan's algorithm on each unvisited node
        for (uint256 i = 0; i < n; i++) {
            if (state.disc[i] == type(uint256).max) { // unvisited
                tarjanDFS(i, state);
            }
        }

        // Convert collected SCCs to AtomicBatch format
        batches = convertSCCsToBatches(state.sccs, state.sccCount, txHashes);

        return batches;
    }

    /**
     * @notice Initialize Tarjan's algorithm state
     * @param txHashes Transaction hashes
     * @param edges Dependency edges
     * @return state Initialized TarjanState struct
     */
    function initializeTarjanState(
        bytes32[] memory txHashes,
        DependencyEdge[] memory edges
    ) internal pure returns (TarjanState memory state) {
        uint256 n = txHashes.length;

        state.txHashes = txHashes;
        state.n = n;
        state.time = 0;
        state.sccCount = 0;

        // Initialize arrays
        state.disc = new uint256[](n);
        state.low = new uint256[](n);
        state.onStack = new bool[](n);
        state.stack = new uint256[](n);
        state.stackTop = 0;
        state.sccId = new uint256[](n);

        // Mark all as unvisited
        for (uint256 i = 0; i < n; i++) {
            state.disc[i] = type(uint256).max;
            state.low[i] = type(uint256).max;
            state.sccId[i] = type(uint256).max;
        }

        // Build adjacency list
        state.adj = buildAdjacencyList(txHashes, edges);

        // Allocate SCC storage (max n SCCs if no cycles)
        state.sccs = new uint256[][](n);

        return state;
    }

    /**
     * @notice Build adjacency list from dependency edges
     * @param txHashes Transaction hashes
     * @param edges Dependency edges (u -> v means u must precede v)
     * @return adj Adjacency list: adj[i] = [j, k, ...] means edges i->j, i->k
     */
    function buildAdjacencyList(
        bytes32[] memory txHashes,
        DependencyEdge[] memory edges
    ) internal pure returns (uint256[][] memory adj) {
        uint256 n = txHashes.length;

        // Count outgoing edges per node
        uint256[] memory outDegree = new uint256[](n);

        for (uint256 i = 0; i < edges.length; i++) {
            uint256 from = findTxIndex(txHashes, edges[i].fromTx);
            outDegree[from]++;
        }

        // Allocate adjacency lists
        adj = new uint256[][](n);
        for (uint256 i = 0; i < n; i++) {
            adj[i] = new uint256[](outDegree[i]);
        }

        // Fill adjacency lists
        uint256[] memory insertIndex = new uint256[](n);

        for (uint256 i = 0; i < edges.length; i++) {
            uint256 from = findTxIndex(txHashes, edges[i].fromTx);
            uint256 to = findTxIndex(txHashes, edges[i].toTx);

            adj[from][insertIndex[from]] = to;
            insertIndex[from]++;
        }

        return adj;
    }

    /**
     * @notice Tarjan's DFS recursive implementation
     * @dev This is the core of Tarjan's algorithm
     * @param u Current node index
     * @param state Algorithm state (passed by reference via memory)
     *
     * ALGORITHM LOGIC:
     * 1. Mark u as visited with discovery time
     * 2. Push u onto stack
     * 3. Explore all neighbors v:
     *    - If v unvisited: recurse, update low[u] = min(low[u], low[v])
     *    - If v on stack: update low[u] = min(low[u], disc[v])
     * 4. If low[u] == disc[u]: u is SCC root, pop SCC from stack
     */
    function tarjanDFS(
        uint256 u,
        TarjanState memory state
    ) internal pure {
        // Initialize discovery time and lowlink
        state.disc[u] = state.time;
        state.low[u] = state.time;
        state.time++;

        // Push u onto stack
        state.stack[state.stackTop] = u;
        state.stackTop++;
        state.onStack[u] = true;

        // Explore neighbors
        uint256[] memory neighbors = state.adj[u];

        for (uint256 i = 0; i < neighbors.length; i++) {
            uint256 v = neighbors[i];

            if (state.disc[v] == type(uint256).max) {
                // v is unvisited - recurse
                tarjanDFS(v, state);

                // Update lowlink after recursion
                if (state.low[v] < state.low[u]) {
                    state.low[u] = state.low[v];
                }
            } else if (state.onStack[v]) {
                // v is on stack (back edge) - update lowlink
                if (state.disc[v] < state.low[u]) {
                    state.low[u] = state.disc[v];
                }
            }
        }

        // If u is SCC root, pop entire SCC from stack
        if (state.low[u] == state.disc[u]) {
            // Collect SCC members
            uint256[] memory sccMembers = new uint256[](state.n);
            uint256 sccSize = 0;

            uint256 v;
            do {
                // Pop from stack
                state.stackTop--;
                v = state.stack[state.stackTop];
                state.onStack[v] = false;

                // Add to SCC
                sccMembers[sccSize] = v;
                state.sccId[v] = state.sccCount;
                sccSize++;
            } while (v != u);

            // Store SCC (trimmed to actual size)
            uint256[] memory scc = new uint256[](sccSize);
            for (uint256 i = 0; i < sccSize; i++) {
                scc[i] = sccMembers[i];
            }

            state.sccs[state.sccCount] = scc;
            state.sccCount++;
        }
    }

    /**
     * @notice Convert SCCs to AtomicBatch format
     * @param sccs Array of SCCs (each SCC is array of node indices)
     * @param sccCount Number of SCCs found
     * @param txHashes Transaction hashes
     * @return batches Array of AtomicBatch structs
     */
    function convertSCCsToBatches(
        uint256[][] memory sccs,
        uint256 sccCount,
        bytes32[] memory txHashes
    ) internal pure returns (AtomicBatch[] memory batches) {
        batches = new AtomicBatch[](sccCount);

        for (uint256 i = 0; i < sccCount; i++) {
            uint256[] memory scc = sccs[i];
            bytes32[] memory txs = new bytes32[](scc.length);

            for (uint256 j = 0; j < scc.length; j++) {
                txs[j] = txHashes[scc[j]];
            }

            batches[i] = AtomicBatch({
                transactions: txs,
                batchIndex: i,
                executed: false
            });
        }

        return batches;
    }

    /**
     * @notice Find index of transaction hash in array
     * @param txHashes Array of transaction hashes
     * @param txHash Hash to find
     * @return index Index of hash (reverts if not found)
     */
    function findTxIndex(
        bytes32[] memory txHashes,
        bytes32 txHash
    ) internal pure returns (uint256 index) {
        for (uint256 i = 0; i < txHashes.length; i++) {
            if (txHashes[i] == txHash) {
                return i;
            }
        }
        revert("AequitasOrdering: Transaction hash not found");
    }

    /**
     * @notice Topologically sort batches using Kahn's algorithm
     * @dev Sorts the DAG of SCCs to produce final ordering
     * @param batches Atomic batches (SCCs) to sort
     * @param edges Original dependency edges
     * @param sccIds Mapping from transaction index to SCC id
     * @return sortedBatches Batches in topological order
     *
     * KAHN'S ALGORITHM:
     * 1. Build condensation graph (edges between SCCs)
     * 2. Calculate in-degree for each SCC
     * 3. Start with zero in-degree SCCs
     * 4. Process queue, removing edges, adding newly zero in-degree SCCs
     * 5. Deterministic tie-breaking: use hash when multiple zero in-degrees
     */
    function topologicalSort(
        AtomicBatch[] memory batches,
        DependencyEdge[] memory edges,
        uint256[] memory sccIds,
        bytes32[] memory txHashes
    ) internal pure returns (AtomicBatch[] memory sortedBatches) {
        uint256 n = batches.length;

        if (n == 0) {
            return new AtomicBatch[](0);
        }

        if (n == 1) {
            return batches;
        }

        // Build condensation graph edges (SCC -> SCC)
        uint256[][] memory sccAdj = buildCondensationGraph(batches, edges, sccIds, txHashes);

        // Calculate in-degrees
        uint256[] memory inDegree = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < sccAdj[i].length; j++) {
                uint256 to = sccAdj[i][j];
                inDegree[to]++;
            }
        }

        // Kahn's algorithm with deterministic tie-breaking
        sortedBatches = new AtomicBatch[](n);
        bool[] memory visited = new bool[](n);
        uint256 sortedCount = 0;

        while (sortedCount < n) {
            // Find all zero in-degree nodes
            uint256 minHash = type(uint256).max;
            uint256 nextNode = type(uint256).max;

            for (uint256 i = 0; i < n; i++) {
                if (!visited[i] && inDegree[i] == 0) {
                    // Deterministic tie-breaking: use hash of first tx in batch
                    uint256 batchHash = uint256(batches[i].transactions[0]);

                    if (batchHash < minHash) {
                        minHash = batchHash;
                        nextNode = i;
                    }
                }
            }

            require(nextNode != type(uint256).max, "AequitasOrdering: Cycle in condensation graph");

            // Add to sorted output
            sortedBatches[sortedCount] = batches[nextNode];
            sortedBatches[sortedCount].batchIndex = sortedCount;
            sortedCount++;
            visited[nextNode] = true;

            // Remove outgoing edges from nextNode
            for (uint256 j = 0; j < sccAdj[nextNode].length; j++) {
                uint256 to = sccAdj[nextNode][j];
                inDegree[to]--;
            }
        }

        return sortedBatches;
    }

    /**
     * @notice Build condensation graph from SCC information
     * @dev Creates DAG where nodes are SCCs and edges connect different SCCs
     * @param batches Atomic batches (SCCs)
     * @param edges Original transaction dependency edges
     * @param sccIds Mapping from tx index to SCC id
     * @param txHashes Transaction hashes
     * @return sccAdj Adjacency list for condensation graph
     */
    function buildCondensationGraph(
        AtomicBatch[] memory batches,
        DependencyEdge[] memory edges,
        uint256[] memory sccIds,
        bytes32[] memory txHashes
    ) internal pure returns (uint256[][] memory sccAdj) {
        uint256 n = batches.length;

        // Count edges between different SCCs
        uint256[] memory outDegree = new uint256[](n);

        for (uint256 i = 0; i < edges.length; i++) {
            uint256 fromIdx = findTxIndex(txHashes, edges[i].fromTx);
            uint256 toIdx = findTxIndex(txHashes, edges[i].toTx);

            uint256 fromSCC = sccIds[fromIdx];
            uint256 toSCC = sccIds[toIdx];

            // Only count edges between different SCCs
            if (fromSCC != toSCC) {
                outDegree[fromSCC]++;
            }
        }

        // Allocate adjacency lists
        sccAdj = new uint256[][](n);
        for (uint256 i = 0; i < n; i++) {
            sccAdj[i] = new uint256[](outDegree[i]);
        }

        // Fill adjacency lists (with deduplication)
        uint256[] memory insertIndex = new uint256[](n);

        for (uint256 i = 0; i < edges.length; i++) {
            uint256 fromIdx = findTxIndex(txHashes, edges[i].fromTx);
            uint256 toIdx = findTxIndex(txHashes, edges[i].toTx);

            uint256 fromSCC = sccIds[fromIdx];
            uint256 toSCC = sccIds[toIdx];

            if (fromSCC != toSCC) {
                // Check for duplicates
                bool isDuplicate = false;
                for (uint256 j = 0; j < insertIndex[fromSCC]; j++) {
                    if (sccAdj[fromSCC][j] == toSCC) {
                        isDuplicate = true;
                        break;
                    }
                }

                if (!isDuplicate && insertIndex[fromSCC] < sccAdj[fromSCC].length) {
                    sccAdj[fromSCC][insertIndex[fromSCC]] = toSCC;
                    insertIndex[fromSCC]++;
                }
            }
        }

        return sccAdj;
    }

    // ============ Fairness Validation ============

    /**
     * @notice Verify that ordering respects fairness threshold
     * @param edge The dependency edge to validate
     * @param validatorCount Total validators
     * @return valid True if edge meets fairness threshold
     */
    function isEdgeFair(
        DependencyEdge memory edge,
        uint256 validatorCount
    ) internal pure returns (bool valid) {
        uint256 threshold = (GAMMA_NUMERATOR * validatorCount + GAMMA_DENOMINATOR - 1)
                            / GAMMA_DENOMINATOR;

        return edge.supportCount >= threshold;
    }

    /**
     * @notice Calculate fairness threshold for given validator count
     * @param validatorCount Total validators (n)
     * @return threshold Minimum validators required for fair ordering
     *
     * SECURITY GUARANTEES:
     * If gamma = 1.0 (unanimous): n > 2f required
     * If gamma = 0.67 (2/3 majority): n >= 3f+1 required (standard BFT)
     */
    function calculateFairnessThreshold(
        uint256 validatorCount
    ) internal pure returns (uint256 threshold) {
        // threshold = ceil((gamma * n) / 1)
        threshold = (GAMMA_NUMERATOR * validatorCount + GAMMA_DENOMINATOR - 1)
                    / GAMMA_DENOMINATOR;
    }
}
