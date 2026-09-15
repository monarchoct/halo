// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HaloTypes} from "./HaloTypes.sol";
import {CurveMath} from "./CurveMath.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {IGraduationAdapter} from "./interfaces/IGraduationAdapter.sol";

contract HaloCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant GRADUATION_GAS_BUDGET = 3_000_000;

    IERC20 public immutable token;
    IERC20 public immutable quote;
    FeeSplitter public immutable feeSplitter;
    IGraduationAdapter public immutable graduationAdapter;
    uint256 public immutable target;
    uint16 public immutable tradingFeeBps;
    uint256 public sold;
    bool public graduated;
    address public liquidityVault;

    struct Observation { uint64 timestamp; uint256 cumulative; }
    Observation[64] private history;
    uint64 private observedAt;
    uint8 private observationHead;
    uint8 private observationCount;
    uint256 private priceCumulative;

    error Closed();
    error InvalidConfiguration();
    error InvalidTrade();
    error Expired();
    error Slippage();
    error IncompatibleToken();
    error OnlySelf();
    error InsufficientGraduationGas();
    error InsufficientHistory();
    event Bought(address indexed payer, address indexed recipient, uint256 tokens, uint256 quoteSpent, uint256 fee);
    event Sold(address indexed payer, address indexed recipient, uint256 tokens, uint256 quoteReceived, uint256 fee);
    event GraduationReady(uint256 quoteReserves);
    event GraduationDeferred(bytes reason);
    event Graduated(address indexed liquidityVault, uint256 quoteReserves, uint256 liquidityTokens);

    constructor(IERC20 token_, IERC20 quote_, FeeSplitter splitter_, IGraduationAdapter adapter_,
        uint256 target_, uint16 tradingFeeBps_) {
        if (address(token_).code.length == 0 || address(quote_).code.length == 0
            || address(adapter_).code.length == 0 || target_ < 1_000_000 || target_ > 1e36
            || address(token_) == address(quote_) || tradingFeeBps_ < 25 || tradingFeeBps_ > 200
            || address(splitter_.asset()) != address(quote_)) revert InvalidConfiguration();
        token = token_;
        quote = quote_;
        feeSplitter = splitter_;
        graduationAdapter = adapter_;
        target = target_;
        tradingFeeBps = tradingFeeBps_;
        observedAt = uint64(block.timestamp);
        observationCount = 1;
        history[0] = Observation(observedAt, 0);
    }

    /// @notice Marginal raw quote units per raw token unit, scaled by 2^128.
    /// The target/supply bounds keep the intermediate denominator and cumulative in uint256.
    function priceX128() public view returns (uint256) {
        uint256 denominator = 4 * HaloTypes.CURVE_SUPPLY - 3 * sold;
        return Math.mulDiv(4 * target * HaloTypes.CURVE_SUPPLY, uint256(1) << 128, denominator * denominator);
    }

    function checkpoint() external { if (graduated) revert Closed(); _observe(); }

    /// @notice Integrates every actual curve trade, including multiple trades in one block.
    /// A caller cannot substitute a sampled spot price for unobserved elapsed time.
    function consult(uint32 minimumSeconds) external view returns (uint256 meanPriceX128, uint256 observedSeconds) {
        if (graduated) revert Closed();
        if (minimumSeconds == 0 || block.timestamp < minimumSeconds) revert InsufficientHistory();
        uint256 cutoff = block.timestamp - minimumSeconds;
        Observation memory selected;
        bool found;
        for (uint256 i; i < observationCount; i++) {
            Observation memory entry = history[i];
            if (entry.timestamp <= cutoff && (!found || entry.timestamp > selected.timestamp)) {
                selected = entry;
                found = true;
            }
        }
        if (!found) revert InsufficientHistory();
        observedSeconds = block.timestamp - selected.timestamp;
        uint256 current = priceCumulative + priceX128() * (block.timestamp - observedAt);
        meanPriceX128 = (current - selected.cumulative) / observedSeconds;
    }

    function _observe() private {
        priceCumulative += priceX128() * (block.timestamp - observedAt);
        observedAt = uint64(block.timestamp);
        if (block.timestamp >= history[observationHead].timestamp + 60) {
            observationHead = uint8((uint256(observationHead) + 1) % 64);
            history[observationHead] = Observation(observedAt, priceCumulative);
            if (observationCount < 64) observationCount++;
        }
    }

    function quoteReserves() public view returns (uint256) {
        return graduated ? 0 : CurveMath.reserves(target, sold);
    }

    function quoteBuy(uint256 maxQuoteIn) public view returns (uint256 tokensOut, uint256 quoteSpent, uint256 fee) {
        if (graduated || sold == HaloTypes.CURVE_SUPPLY) revert Closed();
        return CurveMath.buy(target, sold, maxQuoteIn, tradingFeeBps);
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 quoteOut, uint256 fee) {
        if (graduated || sold == HaloTypes.CURVE_SUPPLY) revert Closed();
        return CurveMath.sell(target, sold, tokensIn, tradingFeeBps);
    }

    function buy(uint256 maxQuoteIn, uint256 minTokensOut, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 tokensOut, uint256 quoteSpent)
    {
        _validateTrade(recipient, deadline);
        uint256 fee;
        (tokensOut, quoteSpent, fee) = quoteBuy(maxQuoteIn);
        if (tokensOut == 0 || quoteSpent == 0) revert InvalidTrade();
        if (tokensOut < minTokensOut) revert Slippage();
        _observe();
        sold += tokensOut;
        uint256 beforeBalance = quote.balanceOf(address(this));
        // Pull only the filled amount. Unused final-buy input never leaves the payer's wallet.
        quote.safeTransferFrom(msg.sender, address(this), quoteSpent);
        if (quote.balanceOf(address(this)) - beforeBalance != quoteSpent) revert IncompatibleToken();
        _payFee(fee);
        token.safeTransfer(recipient, tokensOut);
        emit Bought(msg.sender, recipient, tokensOut, quoteSpent, fee);
        if (sold == HaloTypes.CURVE_SUPPLY) {
            emit GraduationReady(target);
            // Without this floor, gas estimation can deliberately select the cheaper caught-failure branch.
            if (gasleft() < GRADUATION_GAS_BUDGET + 100_000) revert InsufficientGraduationGas();
            try this.finishGraduation{gas: GRADUATION_GAS_BUDGET}() {} catch (bytes memory reason) { emit GraduationDeferred(reason); }
        }
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient, uint256 deadline)
        external nonReentrant returns (uint256 quoteOut)
    {
        _validateTrade(recipient, deadline);
        uint256 fee;
        (quoteOut, fee) = quoteSell(tokensIn);
        if (tokensIn == 0 || quoteOut == 0) revert InvalidTrade();
        if (quoteOut < minQuoteOut) revert Slippage();
        _observe();
        sold -= tokensIn;
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        _payFee(fee);
        quote.safeTransfer(recipient, quoteOut);
        emit Sold(msg.sender, recipient, tokensIn, quoteOut, fee);
    }

    function graduate() external nonReentrant { _graduate(); }

    /// @dev External self-call isolates a failed migration while the original buy stays valid.
    function finishGraduation() external {
        if (msg.sender != address(this)) revert OnlySelf();
        _graduate();
    }

    function _graduate() private {
        if (graduated || sold != HaloTypes.CURVE_SUPPLY) revert Closed();
        graduated = true;
        uint256 baseBefore = token.balanceOf(address(this));
        uint256 quoteBefore = quote.balanceOf(address(this));
        token.forceApprove(address(graduationAdapter), HaloTypes.LIQUIDITY_SUPPLY);
        quote.forceApprove(address(graduationAdapter), target);
        address vault = graduationAdapter.graduate(address(token), address(quote), HaloTypes.LIQUIDITY_SUPPLY,
            target, tradingFeeBps, address(feeSplitter));
        token.forceApprove(address(graduationAdapter), 0);
        quote.forceApprove(address(graduationAdapter), 0);
        if (vault.code.length == 0 || baseBefore - token.balanceOf(address(this)) != HaloTypes.LIQUIDITY_SUPPLY
            || quoteBefore - quote.balanceOf(address(this)) != target) revert InvalidConfiguration();
        liquidityVault = vault;
        emit Graduated(vault, target, HaloTypes.LIQUIDITY_SUPPLY);
    }

    function _payFee(uint256 fee) private {
        if (fee == 0) return;
        quote.forceApprove(address(feeSplitter), fee);
        feeSplitter.deposit(fee);
        quote.forceApprove(address(feeSplitter), 0);
    }

    function _validateTrade(address recipient, uint256 deadline) private view {
        if (deadline < block.timestamp) revert Expired();
        if (recipient == address(0) || recipient == address(this)) revert InvalidTrade();
    }
}
