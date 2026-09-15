// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {SettlementGuard} from "./SettlementGuard.sol";

/// @notice Owns one full-range v4 position forever. There is no path that decreases liquidity or transfers ownership.
contract LockedLiquidityVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    IPoolManager public immutable manager;
    address public immutable initializer;
    IERC20 public immutable baseToken;
    IERC20 public immutable quoteToken;
    FeeSplitter public immutable feeSplitter;
    int24 public constant LOWER_TICK = -887220;
    int24 public constant UPPER_TICK = 887220;
    PoolKey public poolKey;
    uint128 public liquidity;
    uint256 public unconvertedBaseFees;
    uint256 public totalQuoteFees;
    bool private callbackExpected;
    error Unauthorized();
    error InvalidState();
    event LiquidityLocked(uint128 liquidity, uint256 residualBase, uint256 residualQuote);
    event FeesCollected(uint256 quoteFees, uint256 baseFees);
    event BaseFeesConverted(uint256 baseAmount, uint256 quoteAmount);

    constructor(IPoolManager manager_, PoolKey memory key_, IERC20 base_, IERC20 quote_, FeeSplitter splitter_) {
        manager = manager_;
        initializer = msg.sender;
        poolKey = key_;
        baseToken = base_;
        quoteToken = quote_;
        feeSplitter = splitter_;
    }

    function seed(uint128 amount) external nonReentrant {
        if (msg.sender != initializer || liquidity != 0 || amount == 0) revert Unauthorized();
        liquidity = amount;
        callbackExpected = true;
        manager.unlock(abi.encode(uint8(0), uint256(amount)));
        callbackExpected = false;
        emit LiquidityLocked(amount, baseToken.balanceOf(address(this)), quoteToken.balanceOf(address(this)));
    }

    function collectFees() external nonReentrant returns (uint256 quoteFees, uint256 baseFees) {
        if (liquidity == 0) revert InvalidState();
        callbackExpected = true;
        bytes memory result = manager.unlock(abi.encode(uint8(0), uint256(0)));
        callbackExpected = false;
        (quoteFees, baseFees) = abi.decode(result, (uint256, uint256));
        unconvertedBaseFees += baseFees;
        totalQuoteFees += quoteFees;
        if (quoteFees > 0) {
            quoteToken.forceApprove(address(feeSplitter), quoteFees);
            feeSplitter.deposit(quoteFees);
            quoteToken.forceApprove(address(feeSplitter), 0);
        }
        emit FeesCollected(quoteFees, baseFees);
    }

    function marketKey() external view returns (PoolKey memory) { return poolKey; }

    /// @notice Converts only accounted, collected base fees. Seed residuals and position principal remain locked.
    function convertBaseFees(uint256 amount, uint256 minQuoteOut, uint256 deadline)
        external nonReentrant returns (uint256 quoteOut)
    {
        if (deadline < block.timestamp || deadline > block.timestamp + 900 || amount > unconvertedBaseFees)
            revert InvalidState();
        (, uint256 floor, int24 mean) = SettlementGuard.inspect(manager, poolKey, address(baseToken), amount);
        uint256 baseBefore = baseToken.balanceOf(address(this));
        uint256 quoteBefore = quoteToken.balanceOf(address(this));
        unconvertedBaseFees -= amount;
        callbackExpected = true;
        quoteOut = abi.decode(manager.unlock(abi.encode(uint8(1), amount)), (uint256));
        callbackExpected = false;
        (, int24 tick,,) = manager.getSlot0(poolKey.toId());
        SettlementGuard.checkTick(tick, mean);
        if (quoteOut < floor || quoteOut < minQuoteOut || baseBefore - baseToken.balanceOf(address(this)) != amount
            || quoteToken.balanceOf(address(this)) - quoteBefore != quoteOut) revert InvalidState();
        totalQuoteFees += quoteOut;
        quoteToken.forceApprove(address(feeSplitter), quoteOut);
        feeSplitter.deposit(quoteOut);
        quoteToken.forceApprove(address(feeSplitter), 0);
        emit BaseFeesConverted(amount, quoteOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || !callbackExpected) revert Unauthorized();
        (uint8 mode, uint256 amount) = abi.decode(data, (uint8, uint256));
        if (mode == 1) {
            bool zeroForOne = Currency.unwrap(poolKey.currency0) == address(baseToken);
            BalanceDelta swapped = manager.swap(poolKey, SwapParams(zeroForOne, -int256(amount),
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), "");
            int128 input = zeroForOne ? swapped.amount0() : swapped.amount1();
            int128 output = zeroForOne ? swapped.amount1() : swapped.amount0();
            if (input >= 0 || output <= 0 || uint256(-int256(input)) != amount) revert InvalidState();
            _settle(poolKey.currency0, swapped.amount0());
            _settle(poolKey.currency1, swapped.amount1());
            return abi.encode(uint256(uint128(output)));
        }
        if (mode != 0 || amount > type(uint128).max) revert InvalidState();
        uint128 addition = uint128(amount);
        // Only a positive initial addition or a zero-liquidity fee poke can be encoded.
        (BalanceDelta delta,) = manager.modifyLiquidity(poolKey,
            ModifyLiquidityParams(LOWER_TICK, UPPER_TICK, int256(uint256(addition)), bytes32(0)), "");
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();
        _settle(poolKey.currency0, delta0);
        _settle(poolKey.currency1, delta1);
        if (addition != 0) return abi.encode(uint256(0), uint256(0));
        if (delta0 < 0 || delta1 < 0) revert InvalidState();
        bool baseIsZero = Currency.unwrap(poolKey.currency0) == address(baseToken);
        return abi.encode(uint256(uint128(baseIsZero ? delta1 : delta0)), uint256(uint128(baseIsZero ? delta0 : delta1)));
    }

    function _settle(Currency currency, int128 delta) private {
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            if (manager.settle() != amount) revert InvalidState();
        } else if (delta > 0) manager.take(currency, address(this), uint256(uint128(delta)));
    }
}
