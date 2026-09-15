// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {HaloTypes} from "./HaloTypes.sol";

/// @notice Fixed supply. No owner, subsequent mint, transfer tax or pause surface.
contract HaloToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address initialHolder) ERC20(name_, symbol_) {
        _mint(initialHolder, HaloTypes.SUPPLY);
    }
}
