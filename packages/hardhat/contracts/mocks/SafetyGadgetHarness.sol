// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../SafetyGadget.sol";

/**
 * @title SafetyGadgetHarness
 * @notice Test harness that exposes SafetyGadget internal functions for testing
 * @dev This contract is ONLY for testing purposes
 */
contract SafetyGadgetHarness is SafetyGadget {
    
    /**
     * @notice Exposes _consumeNullifier for testing
     */
    function consumeNullifier(
        address sender,
        uint256 nonce,
        bytes32 payloadHash
    ) external returns (bytes32) {
        return _consumeNullifier(sender, nonce, payloadHash);
    }

    /**
     * @notice Exposes _recordSnapshot for testing
     */
    function recordSnapshot(bytes32 settlementId) external {
        _recordSnapshot(settlementId);
    }

    /**
     * @notice Exposes _verifyAncestry for testing
     */
    function verifyAncestry(bytes32 settlementId) external {
        _verifyAncestry(settlementId);
    }
}
