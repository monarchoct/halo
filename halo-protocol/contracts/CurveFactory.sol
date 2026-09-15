// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {HaloTypes} from "./HaloTypes.sol";
import {HaloToken} from "./HaloToken.sol";
import {HaloCurve} from "./HaloCurve.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

/// @notice Immutable permissionless factory: root HALO and every factory token are compatible quotes.
contract CurveFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable rootHalo;
    address public immutable haloTreasury;
    IGraduationAdapter public immutable graduationAdapter;
    mapping(address => address) public curveOf;
    mapping(address => address) public parentOf;
    mapping(address => address) public deployerOf;
    address[] public tokens;

    error InvalidConfiguration();
    error UnsupportedQuote();
    event TokenLaunched(address indexed token, address indexed curve, address indexed parent,
        address deployer, address operations, address splitter, uint256 target, string metadataURI);

    constructor(address rootHalo_, address haloTreasury_, IGraduationAdapter adapter_) {
        if (rootHalo_.code.length == 0 || haloTreasury_ == address(0) || address(adapter_).code.length == 0)
            revert InvalidConfiguration();
        rootHalo = rootHalo_;
        haloTreasury = haloTreasury_;
        graduationAdapter = adapter_;
    }

    function tokenCount() external view returns (uint256) { return tokens.length; }

    function create(string calldata name, string calldata symbol, address parent, uint256 target,
        HaloTypes.Fees calldata fees, string calldata metadataURI) external nonReentrant returns (address token, address curve)
    {
        if (parent != rootHalo && curveOf[parent] == address(0)) revert UnsupportedQuote();
        if (bytes(name).length == 0 || bytes(name).length > 64 || bytes(symbol).length == 0
            || bytes(symbol).length > 12 || bytes(metadataURI).length > 256) revert InvalidConfiguration();
        HaloTypes.validate(fees);
        token = address(new HaloToken(name, symbol, address(this)));
        FeeSplitter splitter = new FeeSplitter(IERC20(parent), fees, haloTreasury);
        curve = address(new HaloCurve(IERC20(token), IERC20(parent), splitter, graduationAdapter, target, fees.tradingBps));
        curveOf[token] = curve;
        parentOf[token] = parent;
        deployerOf[token] = msg.sender;
        tokens.push(token);
        IERC20(token).safeTransfer(curve, HaloTypes.SUPPLY);
        emit TokenLaunched(token, curve, parent, msg.sender, fees.operations, address(splitter), target, metadataURI);
    }
}
