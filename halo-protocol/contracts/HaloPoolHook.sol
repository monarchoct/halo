// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @notice Immutable initialization guard and bounded observation history. No swap fees, pauses or trading permissions.
contract HaloPoolHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    uint160 public constant REQUIRED_FLAGS = (1 << 13) | (1 << 6);
    uint256 public constant HISTORY_SIZE = 64;
    IPoolManager public immutable manager;
    address public immutable initializer;

    struct Observation { uint64 timestamp; int128 cumulative; }
    struct Market {
        uint64 timestamp;
        int128 cumulative;
        int24 tick;
        uint8 head;
        uint8 count;
        Observation[64] history;
    }
    mapping(PoolId => Market) private markets;
    error Unauthorized();
    error InvalidHookAddress();
    error InsufficientHistory();

    constructor(IPoolManager manager_, address initializer_) {
        if ((uint160(address(this)) & ((1 << 14) - 1)) != REQUIRED_FLAGS) revert InvalidHookAddress();
        manager = manager_;
        initializer = initializer_;
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4) {
        if (msg.sender != address(manager) || sender != initializer) revert Unauthorized();
        Market storage market = markets[key.toId()];
        market.timestamp = uint64(block.timestamp);
        market.tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        market.count = 1;
        market.history[0] = Observation(uint64(block.timestamp), 0);
        return IHooks.beforeInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        external returns (bytes4, int128)
    {
        if (msg.sender != address(manager)) revert Unauthorized();
        _record(key.toId());
        return (IHooks.afterSwap.selector, 0);
    }

    function checkpoint(PoolId id) external { _record(id); }

    /// @notice Exact time-weighted mean over an observed window at least minimumSeconds long.
    /// Uses a stored boundary rather than inventing intermediate price observations.
    function consult(PoolId id, uint32 minimumSeconds) external view returns (int24 meanTick, uint256 observedSeconds) {
        Market storage market = markets[id];
        if (market.count == 0 || minimumSeconds == 0 || block.timestamp < minimumSeconds) revert InsufficientHistory();
        uint256 cutoff = block.timestamp - minimumSeconds;
        Observation memory selected;
        bool found;
        for (uint256 i = 0; i < market.count; i++) {
            Observation memory entry = market.history[i];
            if (entry.timestamp <= cutoff && (!found || entry.timestamp > selected.timestamp)) {
                selected = entry;
                found = true;
            }
        }
        if (!found) revert InsufficientHistory();
        int256 current = int256(market.cumulative) + int256(market.tick) * int256(block.timestamp - market.timestamp);
        observedSeconds = block.timestamp - selected.timestamp;
        int256 difference = current - selected.cumulative;
        int256 mean = difference / int256(observedSeconds);
        if (difference < 0 && difference % int256(observedSeconds) != 0) mean--;
        meanTick = int24(mean);
    }

    function _record(PoolId id) private {
        Market storage market = markets[id];
        if (market.count == 0) revert InsufficientHistory();
        market.cumulative += int128(int256(market.tick) * int256(block.timestamp - market.timestamp));
        market.timestamp = uint64(block.timestamp);
        (, int24 tick,,) = manager.getSlot0(id);
        market.tick = tick;
        if (block.timestamp >= market.history[market.head].timestamp + 60) {
            market.head = uint8((uint256(market.head) + 1) % HISTORY_SIZE);
            market.history[market.head] = Observation(uint64(block.timestamp), market.cumulative);
            if (market.count < HISTORY_SIZE) market.count++;
        }
    }
}
