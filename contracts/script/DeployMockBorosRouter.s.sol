// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {MockBorosRouter} from "../src/mocks/MockBorosRouter.sol";

/**
 * @dev Deploys the MockBorosRouter for local Anvil demos.
 */
contract DeployMockBorosRouter is Script {
    function run() external returns (MockBorosRouter router) {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerPrivateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerPrivateKey);
        }

        router = new MockBorosRouter();

        vm.stopBroadcast();
    }
}
