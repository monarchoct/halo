// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library AgentTypes {
    enum ActionKind { Hold, LaunchChild, BuyChild, SellChild }

    struct Policy {
        uint16 maxPositionBps;
        uint16 maxDailyDebitBps;
        uint16 maxLaunchesPerDay;
        uint16 maxSlippageBps;
        uint32 intervalSeconds;
        uint128 workReward;
        uint256 childGraduationTarget;
    }

    struct Action {
        ActionKind kind;
        uint256 nonce;
        uint256 deadline;
        address child;
        uint256 amount;
        uint256 minOutput;
        address beneficiary;
        bytes32 evidenceHash;
        bytes32 snapshotId;
        string name;
        string symbol;
        string metadataURI;
    }

    error InvalidPolicy();

    function validate(Policy memory policy) internal pure {
        if (policy.maxPositionBps == 0 || policy.maxPositionBps > 2_500
            || policy.maxDailyDebitBps == 0 || policy.maxDailyDebitBps > 5_000
            || policy.maxLaunchesPerDay == 0 || policy.maxLaunchesPerDay > 10
            || policy.maxSlippageBps == 0 || policy.maxSlippageBps > 500
            || policy.intervalSeconds < 900 || policy.intervalSeconds > 86400
            || policy.workReward == 0 || policy.workReward > 1 ether
            || policy.childGraduationTarget < 1_000_000 || policy.childGraduationTarget > 1e36) revert InvalidPolicy();
    }
}
