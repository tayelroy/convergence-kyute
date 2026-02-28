// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {kYUteVault} from "../src/kYUteVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployKyuteVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address creOperator = vm.envAddress("CRE_CALLBACK_SIGNER");
        address borosRouter = vm.envAddress("BOROS_ROUTER_ADDRESS");
        address assetToken = vm.envAddress("BOROS_COLLATERAL_ADDRESS"); // usually WETH

        vm.startBroadcast(deployerPrivateKey);

        kYUteVault vault = new kYUteVault(
            IERC20(assetToken),
            creOperator,
            borosRouter
        );

        vm.stopBroadcast();
    }
}
