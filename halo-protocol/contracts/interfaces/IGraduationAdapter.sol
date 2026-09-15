// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IGraduationAdapter {
    /// @dev Pulls the two exact reserve amounts from the calling curve. Returns a locked liquidity vault.
    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount,
        uint16 tradingFeeBps, address feeSplitter) external returns (address liquidityVault);
}
