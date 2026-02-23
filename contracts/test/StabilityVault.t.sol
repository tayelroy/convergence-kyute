// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {StabilityVault} from "../src/StabilityVault.sol";

contract StabilityVaultTest is Test {
    StabilityVault public vault;
    address public mockForwarder = address(0x123);

    // 1. Redefine the event in the test contract so Foundry can capture it
    event HedgeRecorded(address indexed agent, uint256 amount, uint256 timestamp);

    function setUp() public {
        vault = new StabilityVault(mockForwarder);
    }

    function test_onReport_executesHedge() public {
        bytes memory reportPayload = abi.encode(true, uint256(85));

        // 2. Tell Foundry to expect the HedgeRecorded event
        // expectEmit(checkTopic1, checkTopic2, checkTopic3, checkData)
        // We set true for Topic1 (agent) and true for Data (amount, timestamp)
        vm.expectEmit(true, false, false, true);
        
        // 3. Emit the exact event we expect to see
        emit HedgeRecorded(mockForwarder, 0.5 ether, block.timestamp);

        // 4. Pretend to be the Chainlink DON Forwarder
        vm.prank(mockForwarder);

        // 5. Deliver the report! (Note: metadata is first, then the report payload)
        vault.onReport("", reportPayload);
    }
    
    function test_onReport_revertsIfUnauthorized() public {
        bytes memory reportPayload = abi.encode(true, uint256(85));
        
        // Prank from a random hacker address
        vm.prank(address(0xDEAD));
        
        // Expect the exact revert string from your onlyAgent modifier
        vm.expectRevert("Only Agent"); 
        
        vault.onReport("", reportPayload);
    }
}