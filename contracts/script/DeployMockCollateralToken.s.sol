// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {MockCollateralToken} from "../src/mocks/MockCollateralToken.sol";

/**
 * @dev Deploys the mock collateral token for local Anvil demos.
 */
contract DeployMockCollateralToken is Script {
    function run() external returns (MockCollateralToken token) {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerPrivateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerPrivateKey);
        }

        token = new MockCollateralToken();

        vm.stopBroadcast();
    }
}

