// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HaloTypes} from "./HaloTypes.sol";

/// @notice Pull-based immutable payout destinations; one rejecting recipient cannot block others.
contract FeeSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public immutable operations;
    address public immutable creator;
    address public immutable halo;
    uint16 public immutable operationsBps;
    uint16 public immutable haloBps;
    uint256 public totalDeposited;
    uint256 public totalClaimed;
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public totalClaimedBy;

    error IncompatibleToken();
    error InvalidAddress();
    event FeesAccrued(address indexed payer, uint256 amount, uint256 operationsShare, uint256 creatorShare, uint256 haloShare);
    event FeesClaimed(address indexed recipient, uint256 amount);

    constructor(IERC20 asset_, HaloTypes.Fees memory fees_, address halo_) {
        HaloTypes.validate(fees_);
        if (address(asset_).code.length == 0 || halo_ == address(0)) revert InvalidAddress();
        asset = asset_;
        operations = fees_.operations;
        creator = fees_.creator;
        halo = halo_;
        operationsBps = fees_.operationsBps;
        haloBps = fees_.haloBps;
    }

    function deposit(uint256 amount) external nonReentrant {
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert IncompatibleToken();
        uint256 ops = Math.mulDiv(amount, operationsBps, HaloTypes.BPS);
        uint256 protocol = Math.mulDiv(amount, haloBps, HaloTypes.BPS);
        uint256 creatorShare = amount - ops - protocol;
        claimable[operations] += ops;
        claimable[creator] += creatorShare;
        claimable[halo] += protocol;
        totalDeposited += amount;
        emit FeesAccrued(msg.sender, amount, ops, creatorShare, protocol);
    }

    function claim(address recipient) external nonReentrant returns (uint256 amount) {
        amount = claimable[recipient];
        claimable[recipient] = 0;
        totalClaimed += amount;
        totalClaimedBy[recipient] += amount;
        if (amount != 0) asset.safeTransfer(recipient, amount);
        emit FeesClaimed(recipient, amount);
    }
}
