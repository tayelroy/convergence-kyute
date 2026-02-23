// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import {KyuteCCIPSender} from "../src/KyuteCCIPSender.sol";

contract DeployKyuteCCIPSender is Script {
    function run() external {
        address owner = vm.envAddress("CCIP_OWNER");
        address router = vm.envAddress("CCIP_ROUTER");
        address link = vm.envAddress("CCIP_LINK");

        uint64 destinationChainSelector = uint64(
            vm.envOr("CCIP_DEST_CHAIN", uint256(16015286601757825753))
        ); // Sepolia default
        address destinationReceiver = vm.envAddress("CCIP_DEST_RECEIVER");
        uint256 destinationGasLimit = vm.envOr(
            "CCIP_DEST_GAS",
            uint256(200000)
        );
        bool allowOutOfOrderExecution = vm.envOr(
            "CCIP_ALLOW_OUT_OF_ORDER",
            true
        );

        vm.startBroadcast();
        KyuteCCIPSender sender = new KyuteCCIPSender(
            owner,
            router,
            link,
            destinationChainSelector,
            destinationReceiver,
            destinationGasLimit,
            allowOutOfOrderExecution
        );
        console2.log("KyuteCCIPSender deployed at:", address(sender));
        vm.stopBroadcast();
    }
}
