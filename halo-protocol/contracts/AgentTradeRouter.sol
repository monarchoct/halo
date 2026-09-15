// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {HaloCurve} from "./HaloCurve.sol";
import {LockedLiquidityVault} from "./LockedLiquidityVault.sol";
import {SettlementGuard} from "./SettlementGuard.sol";

/// @notice Exact-input trades through a token's official graduated pool. Output always returns to the payer.
/// @dev Quotes execute the real swap in a reverting subcall: no quote changes balances, fees or observations.
contract AgentTradeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    CurveFactory public immutable curveFactory;
    IPoolManager public immutable manager;
    bool private callbackExpected;
    error InvalidMarket();
    error InvalidTrade();
    error Unauthorized();
    error QuoteOutput(uint256 amount);

    constructor(CurveFactory factory_, IPoolManager manager_) {
        if (address(factory_).code.length == 0 || address(manager_).code.length == 0) revert InvalidMarket();
        curveFactory = factory_;
        manager = manager_;
    }

    function marketKey(address token) public view returns (PoolKey memory key) {
        address curveAddress = curveFactory.curveOf(token);
        if (curveAddress == address(0)) revert InvalidMarket();
        HaloCurve curve = HaloCurve(curveAddress);
        if (!curve.graduated()) revert InvalidMarket();
        LockedLiquidityVault vault = LockedLiquidityVault(curve.liquidityVault());
        if (address(vault.manager()) != address(manager)) revert InvalidMarket();
        key = vault.marketKey();
        address parent = curveFactory.parentOf(token);
        if (!((Currency.unwrap(key.currency0) == token && Currency.unwrap(key.currency1) == parent)
            || (Currency.unwrap(key.currency1) == token && Currency.unwrap(key.currency0) == parent))) revert InvalidMarket();
    }

    /// @notice View-only admissibility bound; exact execution still checks the actual swap and output.
    function inspect(address token, bool buy, uint256 amount) external view returns (uint256 minimumOutput) {
        (, minimumOutput,) = SettlementGuard.inspect(manager, marketKey(token),
            buy ? curveFactory.parentOf(token) : token, amount);
    }

    function quote(address token, bool buy, uint256 amount) external nonReentrant returns (uint256 output) {
        PoolKey memory key = marketKey(token);
        address input = buy ? curveFactory.parentOf(token) : token;
        (bool zeroForOne, uint256 floor, int24 mean) = SettlementGuard.inspect(manager, key, input, amount);
        callbackExpected = true;
        try manager.unlock(abi.encode(key, zeroForOne, amount, mean, true)) returns (bytes memory) {
            revert InvalidTrade();
        } catch (bytes memory reason) {
            callbackExpected = false;
            if (reason.length != 36 || bytes4(reason) != QuoteOutput.selector) {
                assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            }
            assembly ("memory-safe") { output := mload(add(reason, 36)) }
        }
        if (output < floor) revert InvalidTrade();
    }

    function trade(address token, bool buy, uint256 amount, uint256 minimumOutput, uint256 deadline)
        external nonReentrant returns (uint256 output)
    {
        if (minimumOutput == 0 || deadline < block.timestamp || deadline > block.timestamp + 1800) revert InvalidTrade();
        PoolKey memory key = marketKey(token);
        IERC20 input = IERC20(buy ? curveFactory.parentOf(token) : token);
        IERC20 outputToken = IERC20(buy ? token : curveFactory.parentOf(token));
        (bool zeroForOne, uint256 floor, int24 mean) = SettlementGuard.inspect(manager, key, address(input), amount);
        uint256 beforeInput = input.balanceOf(address(this));
        uint256 beforeOutput = outputToken.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amount);
        if (input.balanceOf(address(this)) - beforeInput != amount) revert InvalidTrade();
        callbackExpected = true;
        output = abi.decode(manager.unlock(abi.encode(key, zeroForOne, amount, mean, false)), (uint256));
        callbackExpected = false;
        if (output < floor || output < minimumOutput || input.balanceOf(address(this)) != beforeInput
            || outputToken.balanceOf(address(this)) - beforeOutput != output) revert InvalidTrade();
        uint256 beforeRecipient = outputToken.balanceOf(msg.sender);
        outputToken.safeTransfer(msg.sender, output);
        if (outputToken.balanceOf(msg.sender) - beforeRecipient != output) revert InvalidTrade();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || !callbackExpected) revert Unauthorized();
        (PoolKey memory key, bool zeroForOne, uint256 amount, int24 mean, bool quoting) =
            abi.decode(data, (PoolKey, bool, uint256, int24, bool));
        BalanceDelta delta = manager.swap(key, SwapParams(zeroForOne, -int256(amount),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), "");
        int128 input = zeroForOne ? delta.amount0() : delta.amount1();
        int128 output = zeroForOne ? delta.amount1() : delta.amount0();
        if (input >= 0 || output <= 0 || uint256(-int256(input)) != amount) revert InvalidTrade();
        (, int24 tick,,) = manager.getSlot0(key.toId());
        SettlementGuard.checkTick(tick, mean);
        if (quoting) revert QuoteOutput(uint256(uint128(output)));
        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = zeroForOne ? key.currency1 : key.currency0;
        manager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(manager), amount);
        if (manager.settle() != amount) revert InvalidTrade();
        manager.take(currencyOut, address(this), uint256(uint128(output)));
        return abi.encode(uint256(uint128(output)));
    }
}
