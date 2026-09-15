// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HaloCurve} from "../../contracts/HaloCurve.sol";

/// @dev TEST ONLY: a funded same-block round trip must contribute zero time to the average.
contract CurveOracleRoundTrip {
    function run(HaloCurve curve, uint256 amount) external {
        (uint256 beforePrice, uint256 beforeWindow) = curve.consult(1800);
        uint256 sold = curve.sold();
        IERC20 quote = curve.quote();
        quote.transferFrom(msg.sender, address(this), amount);
        quote.approve(address(curve), amount);
        (uint256 tokens,) = curve.buy(amount, 1, address(this), block.timestamp);
        curve.token().approve(address(curve), tokens);
        curve.sell(tokens, 1, address(this), block.timestamp);
        (uint256 afterPrice, uint256 afterWindow) = curve.consult(1800);
        require(beforePrice == afterPrice && beforeWindow == afterWindow && sold == curve.sold(), "FLASH_PRICE_ENTERED_HISTORY");
        quote.transfer(msg.sender, quote.balanceOf(address(this)));
    }
}
