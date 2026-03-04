// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Local-demo collateral token used when running Anvil without mainnet forking.
 */
contract MockCollateralToken is ERC20 {
    constructor() ERC20("Mock Collateral", "mCOLL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

