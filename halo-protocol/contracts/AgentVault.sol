// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HaloTypes} from "./HaloTypes.sol";
import {AgentTypes} from "./AgentTypes.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {HaloCurve} from "./HaloCurve.sol";
import {IDecisionVerifier} from "./interfaces/IDecisionVerifier.sol";
import {IFeeSettlement} from "./interfaces/IFeeSettlement.sol";
import {AgentFeeTreasury} from "./AgentFeeTreasury.sol";
import {AgentTradeRouter} from "./AgentTradeRouter.sol";

/// @notice A persistent multi-token deployer. After activation, no human key controls the vault.
/// @dev Trades use the curve until graduation, then the immutable official-pool router.
contract AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable registry;
    address public immutable creator;
    CurveFactory public immutable curveFactory;
    IERC20 public immutable operatingToken;
    IDecisionVerifier public immutable decisionVerifier;
    bytes32 public immutable coreId;
    bytes32 public immutable manifestHash;
    bytes32 public immutable policyHash;
    AgentFeeTreasury public immutable feeTreasury;
    AgentTradeRouter public immutable tradeRouter;
    AgentTypes.Policy public policy;
    HaloTypes.Fees public fees;
    IERC20 public agentToken;
    bool public active;
    uint256 public nonce;
    uint256 public lastExecutedAt;
    uint256 public capitalBasis;
    uint256 public dayIndex;
    uint256 public dailyDebit;
    uint256 public dailyLaunches;
    uint256 public totalWorkPaid;
    int256 public realizedPnl;
    address[] public children;
    mapping(address => bool) public isChild;
    mapping(address => uint256) public positionCost;
    mapping(address => bytes32) public narrativeEvidence;

    struct TradeSnapshot {
        uint256 nonce;
        uint256 blockNumber;
        uint256 timestamp;
        uint256 sold;
        uint256 amount;
        uint256 quotedOutput;
        address child;
        AgentTypes.ActionKind kind;
        bool graduated;
    }
    mapping(bytes32 => TradeSnapshot) public tradeSnapshots;

    error Unauthorized();
    error InvalidState();
    error InvalidAction();
    error InvalidProof();
    error FundingRequired();
    error IntervalNotElapsed();
    error LimitExceeded();
    error InvalidSnapshot();
    event Activated(bytes32 indexed manifestHash, bytes32 indexed policyHash, uint256 tradingCapital, uint256 operatingFunds);
    event ChildLaunched(address indexed token, address indexed curve, bytes32 indexed evidenceHash, string metadataURI);
    event ActionExecuted(uint256 indexed nonce, AgentTypes.ActionKind indexed kind, bytes32 indexed actionCommitment,
        address child, uint256 amount, uint256 result, address beneficiary, uint256 workReward, bytes32 evidenceHash);
    event PreActivationWithdrawal(address indexed token, uint256 amount);
    event TradeObserved(bytes32 indexed snapshotId, address indexed child, uint256 indexed nonce,
        AgentTypes.ActionKind kind, uint256 amount, uint256 quotedOutput, uint256 sold, uint256 blockNumber, uint256 timestamp);

    constructor(address creator_, CurveFactory factory_, IERC20 operatingToken_, IDecisionVerifier verifier_,
        bytes32 manifestHash_, AgentTypes.Policy memory policy_, HaloTypes.Fees memory fees_, IFeeSettlement settlement_)
    {
        AgentTypes.validate(policy_);
        HaloTypes.validate(fees_);
        if (creator_ == address(0) || address(factory_).code.length == 0 || address(operatingToken_).code.length == 0
            || address(verifier_).code.length == 0 || manifestHash_ == bytes32(0)
            || address(settlement_).code.length == 0 || settlement_.curveFactory() != address(factory_)
            || settlement_.operatingToken() != address(operatingToken_)) revert InvalidState();
        registry = msg.sender;
        creator = creator_;
        curveFactory = factory_;
        operatingToken = operatingToken_;
        decisionVerifier = verifier_;
        coreId = verifier_.coreId();
        if (coreId == bytes32(0)) revert InvalidState();
        manifestHash = manifestHash_;
        policy = policy_;
        feeTreasury = AgentFeeTreasury(settlement_.createTreasury(policy_.workReward));
        tradeRouter = AgentTradeRouter(settlement_.tradeRouter());
        if (address(tradeRouter.curveFactory()) != address(factory_)) revert InvalidState();
        fees_.operations = address(feeTreasury);
        if (fees_.creator == fees_.operations) revert InvalidState();
        fees = fees_;
        policyHash = keccak256(abi.encode(policy_, fees_, manifestHash_, address(verifier_), coreId, address(settlement_), address(tradeRouter)));
    }

    function initializeToken(IERC20 token_) external {
        if (msg.sender != registry || address(agentToken) != address(0)) revert Unauthorized();
        if (curveFactory.curveOf(address(token_)) == address(0)
            || curveFactory.parentOf(address(token_)) != curveFactory.rootHalo()) revert InvalidState();
        agentToken = token_;
    }

    function childCount() external view returns (uint256) { return children.length; }

    function reserveRequired(uint256 days_) public view returns (uint256) {
        return Math.ceilDiv(days_ * 86400, policy.intervalSeconds) * policy.workReward;
    }

    function activate() external nonReentrant {
        if (msg.sender != creator) revert Unauthorized();
        if (active || address(agentToken) == address(0)) revert InvalidState();
        uint256 operatingFunds = operatingToken.balanceOf(address(this));
        uint256 tradingCapital = agentToken.balanceOf(address(this));
        if (operatingFunds < reserveRequired(30) || tradingCapital == 0) revert FundingRequired();
        capitalBasis = tradingCapital;
        active = true;
        dayIndex = block.timestamp / 86400;
        emit Activated(manifestHash, policyHash, tradingCapital, operatingFunds);
    }

    function withdrawBeforeActivation(IERC20 asset, uint256 amount) external nonReentrant {
        if (active || msg.sender != creator) revert Unauthorized();
        asset.safeTransfer(creator, amount);
        emit PreActivationWithdrawal(address(asset), amount);
    }

    /// @notice Permissionless, immutable observation for one proposed trade and execution nonce.
    /// @dev A recorded quote limits later slippage; it is not itself a manipulation-resistant market oracle.
    function snapshotTrade(address child, AgentTypes.ActionKind kind, uint256 amount) external nonReentrant returns (bytes32 id) {
        if (!active || !isChild[child] || amount == 0
            || (kind != AgentTypes.ActionKind.BuyChild && kind != AgentTypes.ActionKind.SellChild)) revert InvalidAction();
        HaloCurve curve = HaloCurve(curveFactory.curveOf(child));
        bool graduated = curve.graduated();
        uint256 quotedOutput;
        if (graduated) quotedOutput = tradeRouter.quote(child, kind == AgentTypes.ActionKind.BuyChild, amount);
        else if (kind == AgentTypes.ActionKind.BuyChild) (quotedOutput,,) = curve.quoteBuy(amount);
        else (quotedOutput,) = curve.quoteSell(amount);
        if (quotedOutput == 0) revert InvalidAction();
        TradeSnapshot memory observation = TradeSnapshot(nonce, block.number, block.timestamp,
            curve.sold(), amount, quotedOutput, child, kind, graduated);
        id = keccak256(abi.encode("HALO_TRADE_SNAPSHOT_V2", block.chainid, address(this), address(tradeRouter), observation));
        tradeSnapshots[id] = observation;
        emit TradeObserved(id, child, nonce, kind, amount, quotedOutput, observation.sold, block.number, block.timestamp);
    }

    function minimumSnapshotOutput(bytes32 id) public view returns (uint256) {
        return Math.mulDiv(tradeSnapshots[id].quotedOutput, HaloTypes.BPS - policy.maxSlippageBps,
            HaloTypes.BPS, Math.Rounding.Ceil);
    }

    /// @notice Authoritative Boolean inputs plus a commitment to the complete action and accounted treasury state.
    /// @dev Live balances are checked as inequalities; unsolicited donations cannot invalidate a passing proof.
    function decisionContext(AgentTypes.Action calldata action) public view
        returns (bytes32 commitment, uint256[] memory publicState)
    {
        uint256 day = block.timestamp / 86400;
        uint256 debit = day == dayIndex ? dailyDebit : 0;
        uint256 launches = day == dayIndex ? dailyLaunches : 0;
        publicState = _decisionFacts(action, debit, launches);
        commitment = keccak256(abi.encode("HALO_ACTION_V2", block.chainid, address(this), policyHash, coreId,
            action, day, capitalBasis, debit, launches, positionCost[action.child], children.length, totalWorkPaid));
    }

    function execute(AgentTypes.Action calldata action, bytes calldata proof) external nonReentrant {
        if (!active) revert InvalidState();
        if (action.nonce != nonce || action.deadline < block.timestamp || action.deadline > block.timestamp + 1800
            || action.beneficiary == address(0) || action.evidenceHash == bytes32(0)) revert InvalidAction();
        if (lastExecutedAt != 0 && block.timestamp < lastExecutedAt + policy.intervalSeconds) revert IntervalNotElapsed();
        uint256 operatingFunds = operatingToken.balanceOf(address(this));
        if (operatingFunds < policy.workReward) revert FundingRequired();
        bool increasesExposure = action.kind == AgentTypes.ActionKind.LaunchChild || action.kind == AgentTypes.ActionKind.BuyChild;
        if (increasesExposure && operatingFunds < reserveRequired(7) + policy.workReward) revert FundingRequired();
        if ((action.kind == AgentTypes.ActionKind.BuyChild || action.kind == AgentTypes.ActionKind.SellChild)
            && !_snapshotUsable(action)) revert InvalidSnapshot();
        (bytes32 commitment, uint256[] memory state) = decisionContext(action);
        if (!decisionVerifier.verifyDecision(proof, commitment, state)) revert InvalidProof();
        uint256 day = block.timestamp / 86400;
        if (day != dayIndex) { dayIndex = day; dailyDebit = 0; dailyLaunches = 0; }
        nonce++;
        lastExecutedAt = block.timestamp;
        uint256 result;
        address child = action.child;

        if (action.kind == AgentTypes.ActionKind.LaunchChild) {
            if (dailyLaunches >= policy.maxLaunchesPerDay) revert LimitExceeded();
            if (action.child != address(0) || action.amount != 0 || action.minOutput != 0
                || action.snapshotId != bytes32(0)) revert InvalidAction();
            dailyLaunches++;
            address curve;
            (child, curve) = curveFactory.create(action.name, action.symbol, address(agentToken),
                policy.childGraduationTarget, fees, action.metadataURI);
            isChild[child] = true;
            narrativeEvidence[child] = action.evidenceHash;
            children.push(child);
            emit ChildLaunched(child, curve, action.evidenceHash, action.metadataURI);
        } else if (action.kind == AgentTypes.ActionKind.BuyChild) {
            _validateChildTrade(action);
            uint256 dailyLimit = Math.mulDiv(capitalBasis, policy.maxDailyDebitBps, HaloTypes.BPS);
            uint256 positionLimit = Math.mulDiv(capitalBasis, policy.maxPositionBps, HaloTypes.BPS);
            if (action.amount > dailyLimit || dailyDebit + action.amount > dailyLimit
                || positionCost[child] + action.amount > positionLimit) revert LimitExceeded();
            address curve = curveFactory.curveOf(child);
            bool graduated = HaloCurve(curve).graduated();
            address spender = graduated ? address(tradeRouter) : curve;
            agentToken.forceApprove(spender, action.amount);
            uint256 beforeBalance = agentToken.balanceOf(address(this));
            uint256 beforeChild = IERC20(child).balanceOf(address(this));
            uint256 spent;
            if (graduated) {
                result = tradeRouter.trade(child, true, action.amount, action.minOutput, action.deadline);
                spent = action.amount;
            } else (result, spent) = HaloCurve(curve).buy(action.amount, action.minOutput, address(this), action.deadline);
            agentToken.forceApprove(spender, 0);
            if (beforeBalance - agentToken.balanceOf(address(this)) != spent
                || IERC20(child).balanceOf(address(this)) - beforeChild != result) revert InvalidState();
            dailyDebit += spent;
            positionCost[child] += spent;
        } else if (action.kind == AgentTypes.ActionKind.SellChild) {
            _validateChildTrade(action);
            IERC20 asset = IERC20(child);
            uint256 balance = asset.balanceOf(address(this));
            if (action.amount > balance) revert InvalidAction();
            uint256 removedCost = Math.mulDiv(positionCost[child], action.amount, balance);
            address curve = curveFactory.curveOf(child);
            bool graduated = HaloCurve(curve).graduated();
            address spender = graduated ? address(tradeRouter) : curve;
            asset.forceApprove(spender, action.amount);
            uint256 beforeBalance = agentToken.balanceOf(address(this));
            if (graduated) result = tradeRouter.trade(child, false, action.amount, action.minOutput, action.deadline);
            else result = HaloCurve(curve).sell(action.amount, action.minOutput, address(this), action.deadline);
            asset.forceApprove(spender, 0);
            if (agentToken.balanceOf(address(this)) - beforeBalance != result
                || balance - asset.balanceOf(address(this)) != action.amount) revert InvalidState();
            positionCost[child] -= removedCost;
            if (result >= removedCost) {
                capitalBasis += result - removedCost;
                realizedPnl += int256(result - removedCost);
            } else {
                capitalBasis -= removedCost - result;
                realizedPnl -= int256(removedCost - result);
            }
        } else {
            if (action.child != address(0) || action.amount != 0 || action.minOutput != 0
                || action.snapshotId != bytes32(0)
                || bytes(action.name).length != 0 || bytes(action.symbol).length != 0 || bytes(action.metadataURI).length != 0)
                revert InvalidAction();
        }
        totalWorkPaid += policy.workReward;
        operatingToken.safeTransfer(action.beneficiary, policy.workReward);
        emit ActionExecuted(action.nonce, action.kind, commitment, child, action.amount, result,
            action.beneficiary, policy.workReward, action.evidenceHash);
    }

    /// @notice Earned fees can be collected by anyone, but always arrive at this agent's immutable operations destination.
    function claimFees(address token_) external nonReentrant {
        if (token_ != address(agentToken) && !isChild[token_]) revert InvalidAction();
        feeTreasury.claimFees(token_);
    }

    function _validateChildTrade(AgentTypes.Action calldata action) private view {
        if (!isChild[action.child] || action.amount == 0 || action.minOutput == 0
            || bytes(action.name).length != 0 || bytes(action.symbol).length != 0 || bytes(action.metadataURI).length != 0)
            revert InvalidAction();
    }

    function _snapshotUsable(AgentTypes.Action calldata action) private view returns (bool) {
        TradeSnapshot storage observation = tradeSnapshots[action.snapshotId];
        return action.snapshotId != bytes32(0) && observation.blockNumber < block.number
            && observation.timestamp != 0 && block.timestamp <= observation.timestamp + 900
            && observation.nonce == nonce && observation.child == action.child && observation.kind == action.kind
            && observation.amount == action.amount && action.minOutput >= minimumSnapshotOutput(action.snapshotId)
            && observation.graduated == HaloCurve(curveFactory.curveOf(action.child)).graduated();
    }

    function _decisionFacts(AgentTypes.Action calldata action, uint256 debit, uint256 launches)
        private view returns (uint256[] memory facts)
    {
        facts = new uint256[](10);
        bool launch = action.kind == AgentTypes.ActionKind.LaunchChild;
        bool buy = action.kind == AgentTypes.ActionKind.BuyChild;
        bool sell = action.kind == AgentTypes.ActionKind.SellChild;
        uint256 operatingFunds = operatingToken.balanceOf(address(this));
        facts[0] = active ? 1 : 0;
        facts[1] = action.nonce == nonce && action.deadline >= block.timestamp && action.deadline <= block.timestamp + 1800
            && action.beneficiary != address(0) && action.evidenceHash != bytes32(0) ? 1 : 0;
        facts[2] = lastExecutedAt == 0 || block.timestamp >= lastExecutedAt + policy.intervalSeconds ? 1 : 0;
        facts[3] = operatingFunds >= policy.workReward ? 1 : 0;
        facts[4] = !(launch || buy) || operatingFunds >= reserveRequired(7) + policy.workReward ? 1 : 0;
        if (launch) {
            facts[5] = action.child == address(0) && action.amount == 0 && action.minOutput == 0
                && action.snapshotId == bytes32(0) && bytes(action.name).length > 0 && bytes(action.name).length <= 64
                && bytes(action.symbol).length > 0 && bytes(action.symbol).length <= 12
                && bytes(action.metadataURI).length <= 256 ? 1 : 0;
        } else {
            bool emptyMetadata = bytes(action.name).length == 0 && bytes(action.symbol).length == 0
                && bytes(action.metadataURI).length == 0;
            facts[5] = emptyMetadata && (buy || sell
                ? isChild[action.child] && action.amount > 0 && action.minOutput > 0
                : action.child == address(0) && action.amount == 0 && action.minOutput == 0 && action.snapshotId == bytes32(0)) ? 1 : 0;
        }
        facts[6] = !launch || launches < policy.maxLaunchesPerDay ? 1 : 0;
        uint256 dailyLimit = Math.mulDiv(capitalBasis, policy.maxDailyDebitBps, HaloTypes.BPS);
        uint256 positionLimit = Math.mulDiv(capitalBasis, policy.maxPositionBps, HaloTypes.BPS);
        facts[7] = !buy || (action.amount <= dailyLimit && debit <= dailyLimit - action.amount) ? 1 : 0;
        facts[8] = !buy || (action.amount <= positionLimit && positionCost[action.child] <= positionLimit - action.amount) ? 1 : 0;
        facts[9] = 1;
        if (buy || sell) {
            facts[9] = 0;
            if (isChild[action.child] && _snapshotUsable(action) && action.amount > 0) {
                HaloCurve curve = HaloCurve(curveFactory.curveOf(action.child));
                if (curve.graduated() && (buy ? agentToken.balanceOf(address(this)) : IERC20(action.child).balanceOf(address(this))) >= action.amount) {
                    // The view checks market admissibility; execute independently enforces the exact quoted output floor.
                    try tradeRouter.inspect(action.child, buy, action.amount) returns (uint256 minimum) {
                        facts[9] = minimum > 0 ? 1 : 0;
                    } catch { }
                } else if (!curve.graduated() && buy && agentToken.balanceOf(address(this)) >= action.amount) {
                    try curve.quoteBuy(action.amount) returns (uint256 output, uint256, uint256) {
                        facts[9] = output >= action.minOutput ? 1 : 0;
                    } catch { }
                } else if (!curve.graduated() && sell && IERC20(action.child).balanceOf(address(this)) >= action.amount) {
                    try curve.quoteSell(action.amount) returns (uint256 output, uint256) {
                        facts[9] = output >= action.minOutput ? 1 : 0;
                    } catch { }
                }
            }
        }
    }
}
