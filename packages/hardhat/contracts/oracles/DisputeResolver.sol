// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./OracleAggregator.sol";

/// @title DisputeResolver
/// @notice Handles disputes using real oracle verification
/// @dev Integrates with OracleAggregator for Byzantine-resistant price verification
contract DisputeResolver {

    OracleAggregator public oracleAggregator;

    struct Dispute {
        bytes32 pairId;
        uint256 claimedPrice;
        uint256 claimTimestamp;
        address challenger;
        address prover;
        bool resolved;
        bool proofValid;
        uint256 resolutionTime;
        string resolutionReason;
    }

    mapping(uint256 => Dispute) public disputes;
    uint256 public disputeCount;

    // Dispute parameters
    uint256 public constant DISPUTE_WINDOW = 7 days;    // Time to challenge a claim
    uint256 public constant RESOLUTION_TIMEOUT = 1 hours; // Time to resolve after challenge

    event DisputeRaised(
        uint256 indexed disputeId,
        bytes32 indexed pairId,
        address indexed challenger,
        address prover,
        uint256 claimedPrice
    );

    event DisputeResolved(
        uint256 indexed disputeId,
        bool proofValid,
        string reason
    );

    constructor(address _oracleAggregator) {
        require(_oracleAggregator != address(0), "DisputeResolver: Invalid oracle aggregator");
        oracleAggregator = OracleAggregator(_oracleAggregator);
    }

    /// @notice Raise a dispute against a price claim
    /// @dev Anyone can challenge a claim if they believe it's incorrect
    /// @param pairId Asset pair
    /// @param claimedPrice Price being disputed
    /// @param claimTimestamp When the price was claimed
    /// @param prover Address that made the claim
    /// @return disputeId ID of the created dispute
    function raiseDispute(
        bytes32 pairId,
        uint256 claimedPrice,
        uint256 claimTimestamp,
        address prover
    ) external returns (uint256 disputeId) {
        require(prover != address(0), "DisputeResolver: Invalid prover");
        require(claimedPrice > 0, "DisputeResolver: Invalid price");

        // Verify claim is within dispute window
        require(
            block.timestamp <= claimTimestamp + DISPUTE_WINDOW,
            "DisputeResolver: Claim too old to dispute"
        );

        disputeId = disputeCount++;

        disputes[disputeId] = Dispute({
            pairId: pairId,
            claimedPrice: claimedPrice,
            claimTimestamp: claimTimestamp,
            challenger: msg.sender,
            prover: prover,
            resolved: false,
            proofValid: false,
            resolutionTime: 0,
            resolutionReason: ""
        });

        emit DisputeRaised(
            disputeId,
            pairId,
            msg.sender,
            prover,
            claimedPrice
        );
    }

    /// @notice Resolve a dispute using oracle verification
    /// @dev Uses OracleAggregator to verify the claimed price
    /// @param disputeId Dispute to resolve
    function resolveDispute(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];

        require(!dispute.resolved, "DisputeResolver: Already resolved");
        require(
            block.timestamp <= dispute.claimTimestamp + DISPUTE_WINDOW + RESOLUTION_TIMEOUT,
            "DisputeResolver: Resolution timeout"
        );

        // Use OracleAggregator to verify the claimed price
        (bool isValid, string memory reason) = oracleAggregator.verifyClaimedPrice(
            dispute.pairId,
            dispute.claimedPrice,
            dispute.claimTimestamp
        );

        dispute.resolved = true;
        dispute.proofValid = isValid;
        dispute.resolutionTime = block.timestamp;
        dispute.resolutionReason = reason;

        emit DisputeResolved(disputeId, isValid, reason);
    }

    /// @notice Get dispute details
    /// @param disputeId Dispute to query
    /// @return Dispute struct
    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        return disputes[disputeId];
    }

    /// @notice Check if a dispute can be resolved
    /// @param disputeId Dispute to check
    /// @return True if dispute can be resolved
    function canResolve(uint256 disputeId) external view returns (bool) {
        Dispute memory dispute = disputes[disputeId];

        if (dispute.resolved) return false;
        if (block.timestamp > dispute.claimTimestamp + DISPUTE_WINDOW + RESOLUTION_TIMEOUT) {
            return false;
        }

        return true;
    }

    /// @notice Get active disputes for a prover
    /// @param prover Address to query
    /// @return Array of dispute IDs
    function getProverDisputes(address prover) external view returns (uint256[] memory) {
        uint256 count = 0;

        // Count disputes
        for (uint256 i = 0; i < disputeCount; i++) {
            if (disputes[i].prover == prover && !disputes[i].resolved) {
                count++;
            }
        }

        // Collect dispute IDs
        uint256[] memory disputeIds = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < disputeCount; i++) {
            if (disputes[i].prover == prover && !disputes[i].resolved) {
                disputeIds[index++] = i;
            }
        }

        return disputeIds;
    }

    /// @notice Get active disputes for a challenger
    /// @param challenger Address to query
    /// @return Array of dispute IDs
    function getChallengerDisputes(address challenger) external view returns (uint256[] memory) {
        uint256 count = 0;

        // Count disputes
        for (uint256 i = 0; i < disputeCount; i++) {
            if (disputes[i].challenger == challenger && !disputes[i].resolved) {
                count++;
            }
        }

        // Collect dispute IDs
        uint256[] memory disputeIds = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < disputeCount; i++) {
            if (disputes[i].challenger == challenger && !disputes[i].resolved) {
                disputeIds[index++] = i;
            }
        }

        return disputeIds;
    }

    /// @notice Update oracle aggregator address (admin function)
    /// @dev Only for emergency updates, should be governed in production
    /// @param _newAggregator New oracle aggregator address
    function updateOracleAggregator(address _newAggregator) external {
        require(_newAggregator != address(0), "DisputeResolver: Invalid address");
        oracleAggregator = OracleAggregator(_newAggregator);
    }
}
