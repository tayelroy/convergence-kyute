// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {MockBorosRouter} from "../src/mocks/MockBorosRouter.sol";

/**
 * @dev Deploys the MockBorosRouter for local Anvil demos.
 */
contract DeployMockBorosRouter is Script {
    function run() external returns (MockBorosRouter router) {
        // Let the forge CLI control the broadcast signer via --private-key/--sender.
        vm.startBroadcast();

        router = new MockBorosRouter();

        vm.stopBroadcast();
    }
}
