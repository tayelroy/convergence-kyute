// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {MockCollateralToken} from "../src/mocks/MockCollateralToken.sol";

/**
 * @dev Deploys the mock collateral token for local Anvil demos.
 */
contract DeployMockCollateralToken is Script {
    function run() external returns (MockCollateralToken token) {
        // Let the forge CLI control the broadcast signer via --private-key/--sender.
        vm.startBroadcast();

        token = new MockCollateralToken();

        vm.stopBroadcast();
    }
}
