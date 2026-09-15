// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentTypes} from "./AgentTypes.sol";
import {HaloTypes} from "./HaloTypes.sol";
import {CurveFactory} from "./CurveFactory.sol";
import {AgentVault} from "./AgentVault.sol";
import {IDecisionVerifier} from "./interfaces/IDecisionVerifier.sol";
import {IFeeSettlement} from "./interfaces/IFeeSettlement.sol";

contract AgentRegistry is ReentrancyGuard {
    CurveFactory public immutable curveFactory;
    IERC20 public immutable operatingToken;
    IDecisionVerifier public immutable decisionVerifier;
    IFeeSettlement public immutable feeSettlement;
    address[] public agents;
    mapping(address => bool) public isAgent;
    mapping(address => address) public agentForToken;
    mapping(bytes32 => bool) public manifestUsed;
    error InvalidConfiguration();
    event AgentCreated(address indexed agent, address indexed creator, address indexed token,
        address curve, bytes32 manifestHash, string manifestURI);

    constructor(CurveFactory factory_, IERC20 operatingToken_, IDecisionVerifier verifier_, IFeeSettlement settlement_) {
        if (address(factory_).code.length == 0 || address(operatingToken_).code.length == 0
            || address(verifier_).code.length == 0 || address(settlement_).code.length == 0
            || settlement_.curveFactory() != address(factory_)
            || settlement_.operatingToken() != address(operatingToken_)) revert InvalidConfiguration();
        curveFactory = factory_;
        operatingToken = operatingToken_;
        decisionVerifier = verifier_;
        feeSettlement = settlement_;
    }

    function agentCount() external view returns (uint256) { return agents.length; }

    function createAgent(string calldata name, string calldata symbol, bytes32 manifestHash, string calldata manifestURI,
        uint256 graduationTarget, AgentTypes.Policy calldata policy, HaloTypes.Fees memory fees)
        external nonReentrant returns (address agent, address token, address curve)
    {
        // Manifest reuse is scoped to the creator, preventing someone else from reserving another creator's configuration.
        bytes32 key = keccak256(abi.encode(msg.sender, manifestHash));
        if (manifestUsed[key] || manifestHash == bytes32(0) || bytes(manifestURI).length == 0
            || bytes(manifestURI).length > 256) revert InvalidConfiguration();
        manifestUsed[key] = true;
        fees.operations = msg.sender; // The vault installs its isolated fee treasury before committing the policy.
        AgentVault vault = new AgentVault(msg.sender, curveFactory, operatingToken, decisionVerifier, manifestHash, policy, fees, feeSettlement);
        agent = address(vault);
        fees.operations = address(vault.feeTreasury());
        (token, curve) = curveFactory.create(name, symbol, curveFactory.rootHalo(), graduationTarget, fees, manifestURI);
        vault.initializeToken(IERC20(token));
        isAgent[agent] = true;
        agentForToken[token] = agent;
        agents.push(agent);
        emit AgentCreated(agent, msg.sender, token, curve, manifestHash, manifestURI);
    }
}
