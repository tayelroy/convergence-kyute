// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import { KyuteAutomationUpkeep } from "../src/KyuteAutomationUpkeep.sol";

contract DeployKyuteAutomationUpkeep is Script {
    function run() external {
        address owner = vm.envAddress("AUTOMATION_OWNER");
        address agent = vm.envAddress("AUTOMATION_AGENT");
        uint256 interval = vm.envUint("AUTOMATION_INTERVAL");
        vm.startBroadcast();
        KyuteAutomationUpkeep upkeep = new KyuteAutomationUpkeep(owner, agent, interval);
        console2.log("KyuteAutomationUpkeep deployed at:", address(upkeep));
        vm.stopBroadcast();
    }
}
