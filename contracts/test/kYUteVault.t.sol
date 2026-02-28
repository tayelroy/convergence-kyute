// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {kYUteVault} from "../src/kYUteVault.sol";
import {IBorosRouter} from "../src/interfaces/IBorosRouter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockBorosRouter is IBorosRouter {
    function openPosition(
        address user,
        address token,
        uint256 amount,
        bool isLong
    ) external override {
        // Mock successful open
    }
    function closePosition(address user, address token) external override {
        // Mock successful close
    }
}

contract kYUteVaultTest is Test {
    kYUteVault public vault;
    MockERC20 public asset;
    MockBorosRouter public router;

    address public owner = address(0x1);
    address public creOperator = address(0x2);
    address public user = address(0x3);

    function setUp() public {
        vm.startPrank(owner);
        asset = new MockERC20();
        router = new MockBorosRouter();
        vault = new kYUteVault(asset, creOperator, address(router));
        vm.stopPrank();

        asset.mint(user, 1000 ether);

        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, user); // Provide vault with some TVL
        vm.stopPrank();
    }

    function test_OpenHyperliquidPosition() public {
        vm.prank(user);
        vault.openHyperliquidPosition(
            "", // order
            123, // userId
            address(asset), // asset
            true, // isLong
            10 ether, // notional
            5 // leverage
        );

        (
            address posAsset,
            bool isLong,
            uint256 notional,
            uint256 leverage,
            bool hasBorosHedge,
            address yuToken,
            uint256 lastUpdate
        ) = vault.userPositions(user);
        assertEq(posAsset, address(asset));
        assertEq(isLong, true);
        assertEq(notional, 10 ether);
        assertEq(hasBorosHedge, false);
    }

    function test_ExecuteHedge_Success() public {
        test_OpenHyperliquidPosition();

        bytes32 mockProof = keccak256("proof");

        // CRE Operator calls executeHedge
        vm.prank(creOperator);
        vault.executeHedge(
            123, // userId
            true, // shouldHedge
            address(0x99), // yuToken
            1500, // predictedApr (15%)
            6500, // confidenceBp (65%)
            1000, // borosApr (10%)
            mockProof // proofHash
        );

        (, , , , bool hasBorosHedge, address yuToken, ) = vault.userPositions(
            user
        );
        assertEq(hasBorosHedge, true);
        assertEq(yuToken, address(0x99));
    }

    function test_ExecuteHedge_Revert_InsufficientConfidence() public {
        test_OpenHyperliquidPosition();

        bytes32 mockProof = keccak256("proof");

        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.InsufficientConfidence.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            5000, // 50%, below 60% requirement
            1000,
            mockProof
        );
    }

    function test_ExecuteHedge_Revert_TvlCapBreach() public {
        // User opens a position with > 10% TVL
        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            11 ether,
            5
        ); // TVL is 100 ether, so 11 ether > 10%

        bytes32 mockProof = keccak256("proof");

        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.TvlCapBreach.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            mockProof
        );
    }

    function test_ExecuteHedge_Revert_FeeBufferNotMet() public {
        test_OpenHyperliquidPosition();

        bytes32 mockProof = keccak256("proof");

        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.FeeBufferNotMet.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1005, // 10.05%
            6500,
            1000, // 10% (buffer is 0.1%, meaning predicted must be strictly > 10.1%)
            mockProof
        );
    }

    function test_ExecuteHedge_Revert_OnlyCRE() public {
        test_OpenHyperliquidPosition();
        bytes32 mockProof = keccak256("proof");

        vm.prank(user); // malicious user
        vm.expectRevert(kYUteVault.OnlyCRE.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            mockProof
        );
    }
}
