// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
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
import {RootReferenceMarket} from "./RootReferenceMarket.sol";
import {SettlementGuard} from "./SettlementGuard.sol";
import {AgentFeeTreasury} from "./AgentFeeTreasury.sol";
import {AgentTradeRouter} from "./AgentTradeRouter.sol";
import {IFeeAgent} from "./interfaces/IFeeSettlement.sol";

/// @notice Immutable routes: an agent token -> HALO -> operating token, or HALO -> operating token.
/// No route can transfer arbitrary agent assets or substitute a caller-chosen pool/hook.
contract FeeSettlementRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using BalanceDeltaLibrary for BalanceDelta;
    CurveFactory public immutable curveFactory;
    IERC20 public immutable operatingToken;
    IPoolManager public immutable manager;
    RootReferenceMarket public immutable referenceMarket;
    uint256 public immutable minimumOperatingDepth;
    AgentTradeRouter public immutable tradeRouter;
    mapping(address => address) public treasuryOf;
    bool private callbackExpected;
    error InvalidConfiguration();
    error InvalidConversion();
    error Unauthorized();
    event TreasuryCreated(address indexed agent, address indexed treasury);

    constructor(CurveFactory factory_, IERC20 operating_, RootReferenceMarket reference_, uint256 minimumDepth_) {
        if (address(factory_).code.length == 0 || address(operating_).code.length == 0
            || address(reference_).code.length == 0 || minimumDepth_ == 0
            || reference_.rootHalo() != factory_.rootHalo() || reference_.operatingToken() != address(operating_))
            revert InvalidConfiguration();
        curveFactory = factory_;
        operatingToken = operating_;
        manager = reference_.manager();
        referenceMarket = reference_;
        minimumOperatingDepth = minimumDepth_;
        tradeRouter = new AgentTradeRouter(factory_, reference_.manager());
    }

    function createTreasury(uint256 maximumWorkReward) external nonReentrant returns (address treasury) {
        if (treasuryOf[msg.sender] != address(0) || maximumWorkReward == 0) revert InvalidConfiguration();
        treasury = address(new AgentFeeTreasury(IFeeAgent(msg.sender), curveFactory, operatingToken, maximumWorkReward));
        treasuryOf[msg.sender] = treasury;
        emit TreasuryCreated(msg.sender, treasury);
    }

    function convert(address asset, uint256 amount, uint256 minOutput, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 output)
    {
        if (amount == 0 || recipient == address(0) || recipient == address(this)
            || deadline < block.timestamp || deadline > block.timestamp + 900) revert InvalidConversion();
        address halo = curveFactory.rootHalo();
        if (asset != halo && curveFactory.parentOf(asset) != halo) revert InvalidConversion();
        uint256 beforeInput = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) - beforeInput != amount) revert InvalidConversion();
        uint256 rootAmount = amount;
        if (asset != halo) {
            HaloCurve curve = HaloCurve(curveFactory.curveOf(asset));
            if (curve.graduated()) {
                LockedLiquidityVault vault = LockedLiquidityVault(curve.liquidityVault());
                if (address(vault.manager()) != address(manager)) revert InvalidConfiguration();
                rootAmount = _swap(vault.marketKey(), asset, amount);
            } else {
                (uint256 mean, uint256 seconds_) = curve.consult(SettlementGuard.WINDOW);
                uint256 spot = curve.priceX128();
                if (seconds_ > SettlementGuard.WINDOW * 2 || spot > Math.mulDiv(mean, 10100, 10000)
                    || spot < Math.mulDiv(mean, 9900, 10000)) revert SettlementGuard.UnsafeMarket();
                (uint256 quoted, uint256 fee) = curve.quoteSell(amount);
                if (quoted + fee > Math.mulDiv(curve.quoteReserves(), SettlementGuard.MAX_IMPACT_BPS, 10_000))
                    revert SettlementGuard.InsufficientDepth();
                uint256 minimum = Math.mulDiv(Math.mulDiv(amount, mean, uint256(1) << 128),
                    10_000 - curve.tradingFeeBps(), 10_000);
                minimum = Math.mulDiv(minimum, 10_000 - SettlementGuard.OUTPUT_TOLERANCE_BPS, 10_000, Math.Rounding.Ceil);
                if (minimum == 0 || quoted < minimum) revert SettlementGuard.UnsafeMarket();
                IERC20(asset).forceApprove(address(curve), amount);
                uint256 beforeRoot = IERC20(halo).balanceOf(address(this));
                rootAmount = curve.sell(amount, minimum, address(this), deadline);
                IERC20(asset).forceApprove(address(curve), 0);
                if (IERC20(halo).balanceOf(address(this)) - beforeRoot != rootAmount) revert InvalidConversion();
                spot = curve.priceX128();
                if (spot > Math.mulDiv(mean, 10100, 10000) || spot < Math.mulDiv(mean, 9900, 10000))
                    revert SettlementGuard.UnsafeMarket();
            }
        }
        PoolKey memory rootKey = referenceMarket.marketKey();
        _checkRootDepth(rootKey);
        output = _swap(rootKey, halo, rootAmount);
        _checkRootDepth(rootKey);
        if (output < minOutput || IERC20(asset).balanceOf(address(this)) != beforeInput) revert InvalidConversion();
        operatingToken.safeTransfer(recipient, output);
    }

    function _checkRootDepth(PoolKey memory key) private view {
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        if (sqrtPrice == 0) revert SettlementGuard.InsufficientDepth();
        uint256 liquidity = manager.getLiquidity(key.toId());
        uint256 depth = Currency.unwrap(key.currency0) == address(operatingToken)
            ? Math.mulDiv(liquidity, uint256(1) << 96, sqrtPrice)
            : Math.mulDiv(liquidity, sqrtPrice, uint256(1) << 96);
        if (depth < minimumOperatingDepth) revert SettlementGuard.InsufficientDepth();
    }

    function _swap(PoolKey memory key, address asset, uint256 amount) private returns (uint256 output) {
        (bool zeroForOne, uint256 floor, int24 mean) = SettlementGuard.inspect(manager, key, asset, amount);
        callbackExpected = true;
        output = abi.decode(manager.unlock(abi.encode(key, zeroForOne, amount)), (uint256));
        callbackExpected = false;
        (, int24 tick,,) = manager.getSlot0(key.toId());
        SettlementGuard.checkTick(tick, mean);
        if (output < floor) revert InvalidConversion();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || !callbackExpected) revert Unauthorized();
        (PoolKey memory key, bool zeroForOne, uint256 amount) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta delta = manager.swap(key, SwapParams(zeroForOne, -int256(amount),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), "");
        int128 input = zeroForOne ? delta.amount0() : delta.amount1();
        int128 output = zeroForOne ? delta.amount1() : delta.amount0();
        if (input >= 0 || output <= 0 || uint256(-int256(input)) != amount) revert InvalidConversion();
        Currency currencyIn = zeroForOne ? key.currency0 : key.currency1;
        Currency currencyOut = zeroForOne ? key.currency1 : key.currency0;
        manager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(manager), amount);
        if (manager.settle() != amount) revert InvalidConversion();
        manager.take(currencyOut, address(this), uint256(uint128(output)));
        return abi.encode(uint256(uint128(output)));
    }
}
