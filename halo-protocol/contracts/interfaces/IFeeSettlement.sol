// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IFeeSettlement {
    function curveFactory() external view returns (address);
    function operatingToken() external view returns (address);
    function tradeRouter() external view returns (address);
    function createTreasury(uint256 maximumWorkReward) external returns (address);
    function convert(address asset, uint256 amount, uint256 minOutput, address recipient, uint256 deadline)
        external returns (uint256);
}

interface IFeeAgent {
    function agentToken() external view returns (address);
    function active() external view returns (bool);
    function isChild(address child) external view returns (bool);
}
