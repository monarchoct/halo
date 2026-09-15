// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IDecisionVerifier} from "./interfaces/IDecisionVerifier.sol";

interface IHalo2Verifier {
    function verifyProof(bytes calldata proof, uint256[] calldata instances) external returns (bool);
}

/// @notice Immutable bridge to the public HALO v1 ONNX authorization graph.
/// @dev Facts are reconstructed by AgentVault. Operator-supplied public instances are never accepted.
contract EzklDecisionVerifier is IDecisionVerifier {
    bytes32 public constant MODEL_SHA256 = 0x77d2eba11110e97767e99c15787f796886f41164295b32e7df9d5d4330ce3f89;
    bytes32 public constant VERIFIER_CODE_HASH = 0x00a2201cf2d52a79f8817f1d83d2e90c7a6c0fcb7b0b80ee6d00dc3c2a4dc5d1;
    address public immutable verifier;
    bytes32 public immutable coreId;

    error WrongVerifier();

    constructor(address verifier_) {
        if (verifier_.codehash != VERIFIER_CODE_HASH) revert WrongVerifier();
        verifier = verifier_;
        coreId = keccak256(abi.encode("HALO_EZKL_RULE_CORE_V1", MODEL_SHA256, verifier.codehash));
    }

    function verifyDecision(bytes calldata proof, bytes32 commitment, uint256[] calldata facts)
        external view returns (bool)
    {
        if (facts.length != 10) return false;
        uint256[] memory instances = new uint256[](75);
        for (uint256 i; i < 32; ++i) {
            uint256 value = uint8(commitment[i]);
            instances[i] = value;
            instances[42 + i] = value;
        }
        for (uint256 i; i < 10; ++i) {
            // Requiring a positive authorization also constrains all inputs to Boolean values.
            if (facts[i] != 1) return false;
            instances[32 + i] = facts[i];
        }
        instances[74] = 1;
        // EZKL emits a non-view ABI; staticcall still forbids state changes in its generated verifier.
        (bool success, bytes memory result) = verifier.staticcall(
            abi.encodeCall(IHalo2Verifier.verifyProof, (proof, instances)));
        return success && result.length == 32 && abi.decode(result, (bool));
    }
}
