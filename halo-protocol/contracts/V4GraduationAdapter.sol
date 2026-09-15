// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HaloPoolHook} from "./HaloPoolHook.sol";
import {LockedLiquidityVault} from "./LockedLiquidityVault.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

contract V4GraduationAdapter is IGraduationAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    IPoolManager public immutable manager;
    address public immutable factory;
    HaloPoolHook public immutable hook;
    mapping(address => address) public vaultOfCurve;
    error Unauthorized();
    error InvalidState();
    event PoolGraduated(address indexed curve, address indexed vault, bytes32 indexed poolId, uint160 sqrtPriceX96, uint128 liquidity);

    /// @param expectedFactory The next CREATE address in the deployment sequence; fixed before any agent can exist.
    constructor(IPoolManager manager_, address expectedFactory, bytes32 hookSalt) {
        if (address(manager_).code.length == 0 || expectedFactory == address(0)) revert InvalidState();
        manager = manager_;
        factory = expectedFactory;
        hook = new HaloPoolHook{salt: hookSalt}(manager_, address(this));
    }

    function graduate(address token, address quote, uint256 baseAmount, uint256 quoteAmount, uint16 feeBps, address splitter)
        external nonReentrant returns (address vault)
    {
        if (CurveFactory(factory).curveOf(token) != msg.sender || CurveFactory(factory).parentOf(token) != quote)
            revert Unauthorized();
        if (vaultOfCurve[msg.sender] != address(0) || baseAmount == 0 || quoteAmount == 0) revert InvalidState();
        bool baseIsZero = token < quote;
        PoolKey memory key = PoolKey(Currency.wrap(baseIsZero ? token : quote), Currency.wrap(baseIsZero ? quote : token),
            uint24(feeBps) * 100, 60, IHooks(address(hook)));
        uint256 amount0 = baseIsZero ? baseAmount : quoteAmount;
        uint256 amount1 = baseIsZero ? quoteAmount : baseAmount;
        // Q128 avoids overflowing a Q192 ratio for low-decimal custom quote tokens.
        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(amount1, uint256(1) << 128, amount0)) << 32);
        uint160 lower = TickMath.getSqrtPriceAtTick(-887220);
        uint160 upper = TickMath.getSqrtPriceAtTick(887220);
        if (sqrtPriceX96 <= lower || sqrtPriceX96 >= upper) revert InvalidState();
        uint256 intermediate = Math.mulDiv(sqrtPriceX96, upper, uint256(1) << 96);
        uint256 liquidity0 = Math.mulDiv(amount0, intermediate, upper - sqrtPriceX96);
        uint256 liquidity1 = Math.mulDiv(amount1, uint256(1) << 96, sqrtPriceX96 - lower);
        uint256 amount = Math.min(liquidity0, liquidity1);
        if (amount == 0 || amount > type(uint128).max) revert InvalidState();
        LockedLiquidityVault locked = new LockedLiquidityVault(manager, key, IERC20(token), IERC20(quote), FeeSplitter(splitter));
        vault = address(locked);
        vaultOfCurve[msg.sender] = vault;
        IERC20(token).safeTransferFrom(msg.sender, vault, baseAmount);
        IERC20(quote).safeTransferFrom(msg.sender, vault, quoteAmount);
        manager.initialize(key, sqrtPriceX96);
        locked.seed(uint128(amount));
        emit PoolGraduated(msg.sender, vault, PoolId.unwrap(key.toId()), sqrtPriceX96, uint128(amount));
    }
}
