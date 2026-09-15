// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Bridge to the pinned decision-core verifier. The registry fixes one implementation for its lifetime.
interface IDecisionVerifier {
    function verifyDecision(bytes calldata proof, bytes32 actionCommitment, uint256[] calldata publicState)
        external view returns (bool);
    function coreId() external view returns (bytes32);
}
