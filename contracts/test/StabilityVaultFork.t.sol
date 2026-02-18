// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/StabilityVault.sol";

contract MockPendleRouter {
    function swapExactTokenForPt(
        address /* receiver */,
        address /* market */,
        uint256 /* minPtOut */,
        IPendleRouter.ApproxParams calldata /* guessPtOut */,
        IPendleRouter.TokenInput calldata input,
        IPendleRouter.LimitOrderData calldata /* limit */
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm) {
        return (input.netTokenIn, 0, 0);
    }
}

contract StabilityVaultOpenShortYUTest is Test {
    StabilityVault vault;
    address agent = address(0x7099);

    address constant PENDLE_ROUTER = 0x888888888889758F76e7103c6CbF23ABbF58F946;
    address constant BOROS_ETH_MARKET = 0x8db1397BeB16A368711743Bc42B69904E4e82122;

    function setUp() public {
        vault = new StabilityVault(agent);

        // Inject mock router at the exact router address used in StabilityVault
        MockPendleRouter mock = new MockPendleRouter();
        vm.etch(PENDLE_ROUTER, address(mock).code);

        // Fund the vault
        vm.deal(address(this), 2 ether);
        vault.deposit{value: 1 ether}();
    }

    function testOpenShortYUWithMockRouter() public {
        vm.prank(agent);
        vault.openShortYU(BOROS_ETH_MARKET, 0.5 ether);
    }
}