// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IGraduationAdapter} from "../../contracts/interfaces/IGraduationAdapter.sol";
import {CurveMath} from "../../contracts/CurveMath.sol";
import {IDecisionVerifier} from "../../contracts/interfaces/IDecisionVerifier.sol";

// TEST ONLY. None of these contracts may appear in a production deployment manifest.
contract TestToken is ERC20 {
    constructor() ERC20("Test root HALO", "tHALO") { _mint(msg.sender, 1e40); }
}

contract TestWrappedNative is ERC20 {
    constructor() ERC20("Test wrapped native", "WETH") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "NATIVE_TRANSFER_FAILED");
    }
}

contract TestLiquiditySink { }

contract TestGraduationAdapter is IGraduationAdapter {
    using SafeERC20 for IERC20;
    bool public fail = true;
    address public immutable sink = address(new TestLiquiditySink());
    function setFailure(bool value) external { fail = value; }
    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount, uint16, address)
        external returns (address)
    {
        require(!fail, "TEST_MIGRATION_FAILURE");
        IERC20(token).safeTransferFrom(msg.sender, sink, baseAmount);
        IERC20(quote).safeTransferFrom(msg.sender, sink, quoteAmount);
        return sink;
    }
}

contract CurveMathHarness {
    function reserves(uint256 target, uint256 sold) external pure returns (uint256) { return CurveMath.reserves(target, sold); }
    function buy(uint256 target, uint256 sold, uint256 gross, uint16 fee) external pure returns (uint256, uint256, uint256) {
        return CurveMath.buy(target, sold, gross, fee);
    }
    function sell(uint256 target, uint256 sold, uint256 tokens, uint16 fee) external pure returns (uint256, uint256) {
        return CurveMath.sell(target, sold, tokens, fee);
    }
}

/// @dev TEST ONLY: checks bindings so vault invariants can be exercised independently of the pending EZKL integration.
/// This is not a cryptographic inference verifier and is forbidden in production manifests.
contract TestDecisionVerifier is IDecisionVerifier {
    function coreId() external pure returns (bytes32) { return keccak256("HALO_TEST_ONLY_NO_CRYPTO_PROOF"); }
    function verifyDecision(bytes calldata proof, bytes32 commitment, uint256[] calldata state) external pure returns (bool) {
        return keccak256(proof) == keccak256(abi.encode(commitment, keccak256(abi.encode(state))));
    }
}
