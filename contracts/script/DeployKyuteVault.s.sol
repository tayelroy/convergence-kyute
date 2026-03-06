// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {kYUteVault} from "../src/kYUteVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployKyuteVault is Script {
    function run() external {
        address creOperator = vm.envOr("CRE_CALLBACK_SIGNER", address(0));
        address borosRouter = vm.envAddress("BOROS_ROUTER_ADDRESS");
        address assetToken = vm.envAddress("BOROS_COLLATERAL_ADDRESS"); // usually WETH

        // Let the forge CLI control the broadcast signer via --private-key/--sender.
        vm.startBroadcast();

        if (creOperator == address(0)) {
            creOperator = tx.origin;
        }

        kYUteVault vault = new kYUteVault(
            IERC20(assetToken),
            creOperator,
            borosRouter
        );

        vm.stopBroadcast();
    }
}
