// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HaloTypes} from "./HaloTypes.sol";

/// @notice Exact rational form of the 80/20 virtual constant-product curve.
/// r(s) = ceil(R*s/(4*C-3*s)), hence r(0)=0 and r(C)=R exactly.
library CurveMath {
    error InvalidAmount();

    function reserves(uint256 target, uint256 sold) internal pure returns (uint256) {
        if (sold > HaloTypes.CURVE_SUPPLY) revert InvalidAmount();
        return Math.mulDiv(target, sold, 4 * HaloTypes.CURVE_SUPPLY - 3 * sold, Math.Rounding.Ceil);
    }

    function soldAtReserves(uint256 target, uint256 quote) internal pure returns (uint256) {
        if (quote >= target) return HaloTypes.CURVE_SUPPLY;
        return Math.mulDiv(4 * HaloTypes.CURVE_SUPPLY, quote, target + 3 * quote);
    }

    function buy(uint256 target, uint256 sold, uint256 grossIn, uint16 feeBps)
        internal pure returns (uint256 tokensOut, uint256 spent, uint256 fee)
    {
        uint256 oldReserves = reserves(target, sold);
        uint256 maxNet = Math.mulDiv(grossIn, HaloTypes.BPS - feeBps, HaloTypes.BPS);
        uint256 remaining = target - oldReserves;
        uint256 available = oldReserves + Math.min(maxNet, remaining);
        uint256 nextSold = soldAtReserves(target, available);
        if (nextSold <= sold) return (0, 0, 0);
        tokensOut = nextSold - sold;
        uint256 net = reserves(target, nextSold) - oldReserves;
        if (net == 0) return (0, 0, 0);
        spent = Math.mulDiv(net, HaloTypes.BPS, HaloTypes.BPS - feeBps, Math.Rounding.Ceil);
        fee = spent - net;
    }

    function sell(uint256 target, uint256 sold, uint256 tokensIn, uint16 feeBps)
        internal pure returns (uint256 quoteOut, uint256 fee)
    {
        if (tokensIn > sold) revert InvalidAmount();
        uint256 gross = reserves(target, sold) - reserves(target, sold - tokensIn);
        fee = Math.mulDiv(gross, feeBps, HaloTypes.BPS);
        quoteOut = gross - fee;
    }
}
