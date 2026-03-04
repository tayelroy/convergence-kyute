// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {kYUteVault} from "../src/kYUteVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployKyuteVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address creOperator = vm.envOr("CRE_CALLBACK_SIGNER", address(0));
        address borosRouter = vm.envAddress("BOROS_ROUTER_ADDRESS");
        address assetToken = vm.envAddress("BOROS_COLLATERAL_ADDRESS"); // usually WETH

        if (deployerPrivateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerPrivateKey);
        }

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
