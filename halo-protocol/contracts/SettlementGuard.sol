// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ProtocolFeeLibrary} from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import {HaloPoolHook} from "./HaloPoolHook.sol";

/// @notice Fixed settlement limits, shared by locked-liquidity and agent-fee conversions.
/// TWAP is a price bound, not a guarantee against sustained manipulation in a thin market.
library SettlementGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    uint32 internal constant WINDOW = 1800;
    int24 internal constant MAX_TICK_DEVIATION = 100;
    uint256 internal constant MAX_IMPACT_BPS = 50;
    uint256 internal constant OUTPUT_TOLERANCE_BPS = 200;

    error UnsafeMarket();
    error InsufficientDepth();

    function quote(uint160 sqrtPrice, uint256 amount, bool zeroForOne) internal pure returns (uint256) {
        if (sqrtPrice <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPrice) * sqrtPrice;
            return zeroForOne ? Math.mulDiv(ratioX192, amount, uint256(1) << 192)
                : Math.mulDiv(uint256(1) << 192, amount, ratioX192);
        }
        uint256 ratioX128 = Math.mulDiv(sqrtPrice, sqrtPrice, uint256(1) << 64);
        return zeroForOne ? Math.mulDiv(ratioX128, amount, uint256(1) << 128)
            : Math.mulDiv(uint256(1) << 128, amount, ratioX128);
    }

    function inspect(IPoolManager manager, PoolKey memory key, address input, uint256 amount)
        internal view returns (bool zeroForOne, uint256 minimumOutput, int24 meanTick)
    {
        if (amount == 0 || amount > uint256(uint128(type(int128).max))
            || (input != Currency.unwrap(key.currency0) && input != Currency.unwrap(key.currency1))) revert UnsafeMarket();
        zeroForOne = input == Currency.unwrap(key.currency0);
        PoolId id = key.toId();
        (uint160 sqrtPrice, int24 tick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(id);
        (int24 mean, uint256 observedSeconds) = HaloPoolHook(address(key.hooks)).consult(id, WINDOW);
        if (observedSeconds > WINDOW * 2 || lpFee > 20_000) revert UnsafeMarket();
        meanTick = mean;
        checkTick(tick, meanTick);
        uint256 depth = zeroForOne ? Math.mulDiv(manager.getLiquidity(id), uint256(1) << 96, sqrtPrice)
            : Math.mulDiv(manager.getLiquidity(id), sqrtPrice, uint256(1) << 96);
        // This is virtual depth at the current active liquidity, not the manager's aggregate token balance.
        if (amount > Math.mulDiv(depth, MAX_IMPACT_BPS, 10_000)) revert InsufficientDepth();
        uint16 directionalFee = zeroForOne ? ProtocolFeeLibrary.getZeroForOneFee(protocolFee)
            : ProtocolFeeLibrary.getOneForZeroFee(protocolFee);
        uint24 totalFee = ProtocolFeeLibrary.calculateSwapFee(directionalFee, lpFee);
        uint256 expected = quote(TickMath.getSqrtPriceAtTick(meanTick), amount, zeroForOne);
        minimumOutput = Math.mulDiv(Math.mulDiv(expected, 1_000_000 - totalFee, 1_000_000),
            10_000 - OUTPUT_TOLERANCE_BPS, 10_000, Math.Rounding.Ceil);
        if (minimumOutput == 0) revert InsufficientDepth();
    }

    function checkTick(int24 tick, int24 mean) internal pure {
        if (int256(tick) > int256(mean) + MAX_TICK_DEVIATION
            || int256(tick) < int256(mean) - MAX_TICK_DEVIATION) revert UnsafeMarket();
    }
}
