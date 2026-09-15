// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HaloPoolHook} from "./HaloPoolHook.sol";

/// @notice Optional bootstrap for the externally supplied HALO/operating-token reference market.
/// Only its initial price is set by the supplied initializer. Liquidity is supplied through ordinary v4 interfaces.
/// This contract never creates HALO, holds its allocation, or permits a later change to the market configuration.
contract RootReferenceMarket {
    IPoolManager public immutable manager;
    HaloPoolHook public immutable hook;
    address public immutable rootHalo;
    address public immutable operatingToken;
    address public immutable initializer;
    PoolKey private key;
    error InvalidConfiguration();

    constructor(IPoolManager manager_, address root_, address operating_, uint24 fee_, address initializer_, bytes32 salt_) {
        if (address(manager_).code.length == 0 || root_.code.length == 0 || operating_.code.length == 0
            || root_ == operating_ || initializer_ == address(0) || fee_ > 20_000) revert InvalidConfiguration();
        manager = manager_;
        rootHalo = root_;
        operatingToken = operating_;
        initializer = initializer_;
        hook = new HaloPoolHook{salt: salt_}(manager_, address(this));
        key = PoolKey(Currency.wrap(root_ < operating_ ? root_ : operating_),
            Currency.wrap(root_ < operating_ ? operating_ : root_), fee_, 60, IHooks(address(hook)));
    }

    function marketKey() external view returns (PoolKey memory) { return key; }

    function initialize(uint160 sqrtPriceX96) external {
        if (msg.sender != initializer) revert InvalidConfiguration();
        // PoolManager itself rejects a second initialization.
        manager.initialize(key, sqrtPriceX96);
    }
}
