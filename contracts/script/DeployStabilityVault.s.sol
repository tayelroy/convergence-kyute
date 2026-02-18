// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/StabilityVault.sol";

contract DeployStabilityVault is Script {
    function run() external {
        address agentAddress = vm.envAddress("AGENT_ADDRESS"); // Set as the agent in the vault

        vm.startBroadcast();

        StabilityVault vault = new StabilityVault(agentAddress);
        console.log("StabilityVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
