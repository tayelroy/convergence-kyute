// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/StabilityVault.sol";

contract DeployStabilityVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address agentAddress = vm.envAddress("AGENT_ADDRESS"); // Set this in .env or pass via CLI

        vm.startBroadcast(deployerPrivateKey);

        StabilityVault vault = new StabilityVault(agentAddress);
        console.log("StabilityVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
