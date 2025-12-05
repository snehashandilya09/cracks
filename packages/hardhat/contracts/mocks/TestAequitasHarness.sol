// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/AequitasOrdering.sol";
import "../interfaces/IClearSettle.sol";

/**
 * @title TestAequitasHarness
 * @notice Test harness to expose AequitasOrdering library functions for testing
 * @dev This contract is ONLY for testing Tarjan's SCC algorithm and condensation graph
 */
contract TestAequitasHarness {

    /**
     * @notice Test wrapper for findStronglyConnectedComponents
     * @param txHashes Array of transaction hashes
     * @param edges Dependency edges
     * @return batches Atomic batches (SCCs)
     */
    function testFindSCCs(
        bytes32[] memory txHashes,
        DependencyEdge[] memory edges
    ) external pure returns (AtomicBatch[] memory batches) {
        return AequitasOrdering.findStronglyConnectedComponents(txHashes, edges);
    }

    /**
     * @notice Test wrapper for topological sort
     * @param batches Atomic batches to sort
     * @param edges Original dependency edges
     * @param txHashes Transaction hashes
     * @return sortedBatches Topologically sorted batches
     */
    function testTopologicalSort(
        AtomicBatch[] memory batches,
        DependencyEdge[] memory edges,
        bytes32[] memory txHashes
    ) external pure returns (AtomicBatch[] memory sortedBatches) {
        // First, extract sccIds from batches
        uint256[] memory sccIds = extractSCCIds(batches, txHashes);

        return AequitasOrdering.topologicalSort(batches, edges, sccIds, txHashes);
    }

    /**
     * @notice Test wrapper for buildDependencyGraph
     * @param txHashes Array of transaction hashes
     * @param validatorCount Number of validators
     * @return edges Dependency edges
     */
    function testBuildDependencyGraph(
        bytes32[] memory txHashes,
        uint256 validatorCount
    ) external view returns (DependencyEdge[] memory edges) {
        // This would normally use storage, but for testing we'll create a simple version
        // In real usage, receptionLogs would be in contract storage

        // For now, return empty array (full test would need storage setup)
        return new DependencyEdge[](0);
    }

    /**
     * @notice Extract SCC IDs from batches
     * @dev Helper function to map transactions to their SCC IDs
     * @param batches Atomic batches (SCCs)
     * @param txHashes All transaction hashes
     * @return sccIds Array where sccIds[i] = SCC id of txHashes[i]
     */
    function extractSCCIds(
        AtomicBatch[] memory batches,
        bytes32[] memory txHashes
    ) internal pure returns (uint256[] memory sccIds) {
        sccIds = new uint256[](txHashes.length);

        // Initialize all to max (unassigned)
        for (uint256 i = 0; i < txHashes.length; i++) {
            sccIds[i] = type(uint256).max;
        }

        // Assign SCC IDs based on batch membership
        for (uint256 sccId = 0; sccId < batches.length; sccId++) {
            bytes32[] memory txsInBatch = batches[sccId].transactions;

            for (uint256 j = 0; j < txsInBatch.length; j++) {
                bytes32 tx = txsInBatch[j];

                // Find this tx in txHashes array
                for (uint256 k = 0; k < txHashes.length; k++) {
                    if (txHashes[k] == tx) {
                        sccIds[k] = sccId;
                        break;
                    }
                }
            }
        }

        return sccIds;
    }

    /**
     * @notice Test wrapper for fairness threshold calculation
     * @param validatorCount Number of validators
     * @return threshold Fairness threshold
     */
    function testCalculateFairnessThreshold(
        uint256 validatorCount
    ) external pure returns (uint256 threshold) {
        return AequitasOrdering.calculateFairnessThreshold(validatorCount);
    }

    /**
     * @notice Test wrapper for edge fairness validation
     * @param edge Dependency edge to validate
     * @param validatorCount Total validators
     * @return valid True if edge meets fairness threshold
     */
    function testIsEdgeFair(
        DependencyEdge memory edge,
        uint256 validatorCount
    ) external pure returns (bool valid) {
        return AequitasOrdering.isEdgeFair(edge, validatorCount);
    }
}
