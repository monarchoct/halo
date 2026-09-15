// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {HaloCurve} from "./HaloCurve.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {LockedLiquidityVault} from "./LockedLiquidityVault.sol";
import {IFeeSettlement, IFeeAgent} from "./interfaces/IFeeSettlement.sol";

/// @notice Isolated fee inventory. Neither this contract nor its settlement router can access trading principal.
contract AgentFeeTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IFeeAgent public immutable agent;
    CurveFactory public immutable curveFactory;
    IFeeSettlement public immutable settlement;
    IERC20 public immutable operatingToken;
    uint256 public immutable maximumWorkReward;
    mapping(address => uint256) public pending;
    mapping(address => uint256) public recognizedClaims;
    uint256 public totalOperatingReceived;
    uint256 public totalKeeperPaid;
    struct FeeSource { address token; uint256 baseToConvert; }
    error InvalidSource();
    error InvalidSettlement();
    event FeesRecognized(address indexed token, address indexed asset, uint256 amount);
    event OperatingFunded(address indexed asset, uint256 input, uint256 grossOutput, uint256 netOutput,
        address indexed keeper, uint256 keeperPayment);

    constructor(IFeeAgent agent_, CurveFactory factory_, IERC20 operating_, uint256 maximumWorkReward_) {
        agent = agent_;
        curveFactory = factory_;
        operatingToken = operating_;
        settlement = IFeeSettlement(msg.sender);
        maximumWorkReward = maximumWorkReward_;
    }

    function claimFees(address token) external nonReentrant returns (uint256 received) {
        return _claim(token);
    }

    function _claim(address token) private returns (uint256 received) {
        if (token != agent.agentToken() && !agent.isChild(token)) revert InvalidSource();
        address curve = curveFactory.curveOf(token);
        if (curve == address(0)) revert InvalidSource();
        FeeSplitter splitter = HaloCurve(curve).feeSplitter();
        if (splitter.operations() != address(this)) revert InvalidSource();
        splitter.claim(address(this));
        uint256 claimed = splitter.totalClaimedBy(address(this));
        received = claimed - recognizedClaims[address(splitter)];
        recognizedClaims[address(splitter)] = claimed;
        address asset = address(splitter.asset());
        pending[asset] += received;
        emit FeesRecognized(token, asset, received);
    }

    /// @notice Anyone can replenish even an exhausted operating reserve. Destinations and keeper bounds are immutable.
    /// Direct donations are not classified as earned fees. A failed conversion leaves the accounted fees pending.
    function settle(address asset, uint256 amount, uint256 minGrossOutput, uint256 deadline)
        external nonReentrant returns (uint256 netOutput, uint256 keeperPayment)
    {
        return _settle(asset, amount, minGrossOutput, deadline);
    }

    /// @notice Atomic collection plus paid settlement lets independent keepers cover the whole job's gas.
    /// Each supplied token must belong to this agent; every collected fee still uses its fixed splitter.
    function claimAndSettle(FeeSource[] calldata sources, address asset, uint256 amount, uint256 minGrossOutput, uint256 deadline)
        external nonReentrant returns (uint256 netOutput, uint256 keeperPayment)
    {
        _collect(sources, deadline);
        return _settle(asset, amount, minGrossOutput, deadline);
    }

    /// @notice Also usable with eth_call to quote a batch's actual claimable balances without assuming LP fees.
    function collect(FeeSource[] calldata sources, uint256 deadline)
        external nonReentrant returns (uint256 rootPending, uint256 agentPending)
    {
        _collect(sources, deadline);
        return (pending[curveFactory.rootHalo()], pending[agent.agentToken()]);
    }

    function _collect(FeeSource[] calldata sources, uint256 deadline) private {
        if (deadline < block.timestamp || deadline > block.timestamp + 900) revert InvalidSettlement();
        if (sources.length > 16) revert InvalidSource();
        for (uint256 i; i < sources.length; i++) {
            address token = sources[i].token;
            if (token != agent.agentToken() && !agent.isChild(token)) revert InvalidSource();
            HaloCurve curve = HaloCurve(curveFactory.curveOf(token));
            if (curve.graduated()) {
                LockedLiquidityVault vault = LockedLiquidityVault(curve.liquidityVault());
                vault.collectFees();
                if (sources[i].baseToConvert != 0) vault.convertBaseFees(sources[i].baseToConvert, 0, deadline);
            } else if (sources[i].baseToConvert != 0) revert InvalidSource();
            _claim(token);
        }
    }

    function _settle(address asset, uint256 amount, uint256 minGrossOutput, uint256 deadline)
        private returns (uint256 netOutput, uint256 keeperPayment)
    {
        if (!agent.active() || amount == 0 || amount > pending[asset]
            || (asset != curveFactory.rootHalo() && asset != agent.agentToken())) revert InvalidSettlement();
        pending[asset] -= amount;
        uint256 beforeInput = IERC20(asset).balanceOf(address(this));
        uint256 beforeOutput = operatingToken.balanceOf(address(this));
        IERC20(asset).forceApprove(address(settlement), amount);
        uint256 gross = settlement.convert(asset, amount, minGrossOutput, address(this), deadline);
        IERC20(asset).forceApprove(address(settlement), 0);
        if (gross == 0 || beforeInput - IERC20(asset).balanceOf(address(this)) != amount
            || operatingToken.balanceOf(address(this)) - beforeOutput != gross) revert InvalidSettlement();
        keeperPayment = Math.min(maximumWorkReward, gross / 100);
        netOutput = gross - keeperPayment;
        totalOperatingReceived += netOutput;
        totalKeeperPaid += keeperPayment;
        operatingToken.safeTransfer(address(agent), netOutput);
        if (keeperPayment != 0) operatingToken.safeTransfer(msg.sender, keeperPayment);
        emit OperatingFunded(asset, amount, gross, netOutput, msg.sender, keeperPayment);
    }
}
