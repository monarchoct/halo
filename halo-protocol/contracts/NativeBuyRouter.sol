// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {HaloCurve} from "./HaloCurve.sol";
import {LockedLiquidityVault} from "./LockedLiquidityVault.sol";
import {RootReferenceMarket} from "./RootReferenceMarket.sol";

interface IWrappedNative is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Retail ETH -> wrapped ETH -> HALO -> ancestry -> token purchases.
/// All pools are derived from immutable deployment configuration. No arbitrary calls.
/// Intermediate refunds stay in their denomination; wrapped ETH refunds unwrap to ETH.
contract NativeBuyRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    CurveFactory public immutable factory;
    RootReferenceMarket public immutable referenceMarket;
    IWrappedNative public immutable wrappedNative;
    IPoolManager public immutable manager;
    uint256 public constant MAX_DEPTH = 8;
    bool private callbackExpected;
    error InvalidRoute();
    error InvalidPurchase();
    error Unauthorized();
    error SwapQuote(uint256 output, uint256 spent);
    event NativePurchase(address indexed buyer, address indexed token, uint256 nativeInput, uint256 output);
    event RouteRefund(address indexed buyer, address indexed asset, uint256 amount);

    constructor(CurveFactory factory_, RootReferenceMarket reference_, IWrappedNative wrapped_) {
        if (address(factory_).code.length == 0 || address(reference_).code.length == 0 || address(wrapped_).code.length == 0
            || reference_.rootHalo() != factory_.rootHalo() || reference_.operatingToken() != address(wrapped_)) revert InvalidRoute();
        factory = factory_;
        referenceMarket = reference_;
        wrappedNative = wrapped_;
        manager = reference_.manager();
    }

    receive() external payable { if (msg.sender != address(wrappedNative)) revert Unauthorized(); }

    function route(address token) public view returns (address[] memory assets) {
        address[MAX_DEPTH] memory ancestors;
        address halo = factory.rootHalo();
        uint256 depth;
        while (token != halo) {
            if (depth == MAX_DEPTH || factory.curveOf(token) == address(0)) revert InvalidRoute();
            ancestors[depth++] = token;
            token = factory.parentOf(token);
        }
        assets = new address[](depth + 2);
        assets[0] = address(wrappedNative);
        assets[1] = halo;
        for (uint256 i; i < depth; ++i) assets[i + 2] = ancestors[depth - i - 1];
    }

    function _key(address token) private view returns (PoolKey memory key) {
        if (token == factory.rootHalo()) return referenceMarket.marketKey();
        HaloCurve curve = HaloCurve(factory.curveOf(token));
        if (!curve.graduated()) revert InvalidRoute();
        LockedLiquidityVault vault = LockedLiquidityVault(curve.liquidityVault());
        if (address(vault.manager()) != address(manager)) revert InvalidRoute();
        key = vault.marketKey();
        address parent = factory.parentOf(token);
        if (!((Currency.unwrap(key.currency0) == token && Currency.unwrap(key.currency1) == parent)
            || (Currency.unwrap(key.currency1) == token && Currency.unwrap(key.currency0) == parent))) revert InvalidRoute();
    }

    /// @notice eth_call friendly: exact v4 quote subcalls revert before settlement.
    /// Refunds[i] is unspent assets[i]; outputs[i] is the next hop's amount.
    function quote(address token, uint256 nativeAmount) external nonReentrant
        returns (address[] memory assets, uint256[] memory outputs, uint256[] memory refunds)
    {
        if (nativeAmount == 0) revert InvalidPurchase();
        assets = route(token);
        outputs = new uint256[](assets.length - 1);
        refunds = new uint256[](assets.length - 1);
        uint256 amount = nativeAmount;
        for (uint256 i; i + 1 < assets.length; ++i) {
            uint256 spent;
            if (i == 0 || HaloCurve(factory.curveOf(assets[i + 1])).graduated()) {
                (outputs[i], spent) = _swap(_key(assets[i + 1]), assets[i], amount, true);
            } else {
                (outputs[i], spent,) = HaloCurve(factory.curveOf(assets[i + 1])).quoteBuy(amount);
            }
            if (outputs[i] == 0 || spent > amount) revert InvalidPurchase();
            refunds[i] = amount - spent;
            amount = outputs[i];
        }
    }

    function buy(address token, uint256 minimumOutput, uint256 deadline) external payable nonReentrant returns (uint256 output) {
        if (msg.value == 0 || minimumOutput == 0 || deadline < block.timestamp || deadline > block.timestamp + 1800) revert InvalidPurchase();
        address[] memory assets = route(token);
        uint256[] memory balances = new uint256[](assets.length);
        for (uint256 i; i < assets.length; ++i) balances[i] = IERC20(assets[i]).balanceOf(address(this));
        wrappedNative.deposit{value: msg.value}();
        if (wrappedNative.balanceOf(address(this)) - balances[0] != msg.value) revert InvalidPurchase();
        output = msg.value;
        for (uint256 i; i + 1 < assets.length; ++i) {
            if (i == 0 || HaloCurve(factory.curveOf(assets[i + 1])).graduated()) {
                (output,) = _swap(_key(assets[i + 1]), assets[i], output, false);
            } else {
                HaloCurve curve = HaloCurve(factory.curveOf(assets[i + 1]));
                IERC20(assets[i]).forceApprove(address(curve), output);
                (output,) = curve.buy(output, 1, address(this), deadline);
                IERC20(assets[i]).forceApprove(address(curve), 0);
            }
            if (output == 0) revert InvalidPurchase();
        }
        if (output < minimumOutput || IERC20(token).balanceOf(address(this)) - balances[assets.length - 1] != output) revert InvalidPurchase();
        // Never distribute balances that predated this call, including donated assets.
        for (uint256 i; i < assets.length; ++i) {
            uint256 amount = IERC20(assets[i]).balanceOf(address(this)) - balances[i];
            if (amount == 0) continue;
            if (i == 0) {
                wrappedNative.withdraw(amount);
                (bool ok,) = msg.sender.call{value: amount}("");
                if (!ok) revert InvalidPurchase();
            } else {
                uint256 beforeRecipient = IERC20(assets[i]).balanceOf(msg.sender);
                IERC20(assets[i]).safeTransfer(msg.sender, amount);
                if (IERC20(assets[i]).balanceOf(msg.sender) - beforeRecipient != amount) revert InvalidPurchase();
            }
            if (i + 1 < assets.length) emit RouteRefund(msg.sender, assets[i], amount);
        }
        emit NativePurchase(msg.sender, token, msg.value, output);
    }

    function _swap(PoolKey memory key, address input, uint256 amount, bool quoting) private returns (uint256 output, uint256 spent) {
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert InvalidPurchase();
        bool zeroForOne = Currency.unwrap(key.currency0) == input;
        if (!zeroForOne && Currency.unwrap(key.currency1) != input) revert InvalidRoute();
        callbackExpected = true;
        if (!quoting) {
            (output, spent) = abi.decode(manager.unlock(abi.encode(key, zeroForOne, amount, false)), (uint256, uint256));
        } else {
            try manager.unlock(abi.encode(key, zeroForOne, amount, true)) returns (bytes memory) { revert InvalidPurchase(); }
            catch (bytes memory reason) {
                if (reason.length != 68 || bytes4(reason) != SwapQuote.selector) {
                    assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
                }
                assembly ("memory-safe") { output := mload(add(reason, 36)) spent := mload(add(reason, 68)) }
            }
        }
        callbackExpected = false;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager) || !callbackExpected) revert Unauthorized();
        (PoolKey memory key, bool zeroForOne, uint256 amount, bool quoting) = abi.decode(data, (PoolKey, bool, uint256, bool));
        BalanceDelta delta = manager.swap(key, SwapParams(zeroForOne, -int256(amount),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1), "");
        int128 inputDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert InvalidPurchase();
        uint256 spent = uint256(-int256(inputDelta));
        uint256 output = uint256(uint128(outputDelta));
        if (spent > amount) revert InvalidPurchase();
        if (quoting) revert SwapQuote(output, spent);
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        manager.sync(input);
        IERC20(Currency.unwrap(input)).safeTransfer(address(manager), spent);
        if (manager.settle() != spent) revert InvalidPurchase();
        manager.take(zeroForOne ? key.currency1 : key.currency0, address(this), output);
        return abi.encode(output, spent);
    }
}
