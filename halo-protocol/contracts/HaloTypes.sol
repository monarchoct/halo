// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library HaloTypes {
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant CURVE_SUPPLY = SUPPLY * 4 / 5;
    uint256 internal constant LIQUIDITY_SUPPLY = SUPPLY / 5;
    uint256 internal constant BPS = 10_000;

    struct Fees {
        uint16 tradingBps;
        uint16 operationsBps;
        uint16 haloBps;
        address operations;
        address creator;
    }

    error InvalidFees();

    function validate(Fees memory fees) internal pure {
        if (fees.tradingBps < 25 || fees.tradingBps > 200
            || fees.operationsBps < 5_000 || fees.haloBps < 1_000 || fees.haloBps > 3_000
            || uint256(fees.operationsBps) + fees.haloBps > BPS
            || fees.operations == address(0) || fees.creator == address(0)) revert InvalidFees();
    }
}
