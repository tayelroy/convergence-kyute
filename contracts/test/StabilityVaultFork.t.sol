// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/StabilityVault.sol";

contract StabilityVaultForkTest is Test {
    StabilityVault vault;
    address agent = address(0x7099);

    function setUp() public {
        vault = new StabilityVault(agent);

        // Fund the vault
        vm.deal(address(this), 2 ether);
        vault.deposit{value: 1 ether}();
    }

    function testRecordHedgeEmitsEvent() public {
        vm.expectEmit(false, false, false, true, address(vault));
        emit StabilityVault.ExecutionIntentAuthorized(
            "LONG",
            0.5 ether,
            100,
            block.timestamp
        );

        vm.prank(agent);
        vault.recordHedge(0.5 ether);
    }
}
