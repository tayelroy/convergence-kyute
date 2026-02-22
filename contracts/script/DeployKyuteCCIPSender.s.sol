// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import { KyuteCCIPSender } from "../src/KyuteCCIPSender.sol";

contract DeployKyuteCCIPSender is Script {
    function run() external {
        address owner = vm.envAddress("CCIP_OWNER");
        address router = vm.envAddress("CCIP_ROUTER");
        address link = vm.envAddress("CCIP_LINK");
        vm.startBroadcast();
        KyuteCCIPSender sender = new KyuteCCIPSender(owner, router, link);
        console2.log("KyuteCCIPSender deployed at:", address(sender));
        vm.stopBroadcast();
    }
}
