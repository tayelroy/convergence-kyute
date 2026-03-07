// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console} from "forge-std/Test.sol";
import {kYUteVault} from "../src/kYUteVault.sol";
import {IBorosRouter} from "../src/interfaces/IBorosRouter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockBorosRouter is IBorosRouter {
    uint256 public openCount;
    uint256 public closeCount;
    uint256 public lastAmount;
    bool public lastIsLong;
    address public lastUser;
    address public lastToken;

    function openPosition(
        address user,
        address token,
        uint256 amount,
        bool isLong
    ) external override {
        openCount += 1;
        lastUser = user;
        lastToken = token;
        lastAmount = amount;
        lastIsLong = isLong;
    }
    function closePosition(address user, address token) external override {
        closeCount += 1;
        lastUser = user;
        lastToken = token;
    }
}

contract ReentrantBorosRouter is IBorosRouter {
    kYUteVault public vault;
    bool public reenterOnOpen;
    uint256 public reenterUserId;
    address public reenterYuToken;

    function setVault(kYUteVault _vault) external {
        vault = _vault;
    }

    function armReenterOnOpen(uint256 userId, address yuToken) external {
        reenterOnOpen = true;
        reenterUserId = userId;
        reenterYuToken = yuToken;
    }

    function openPosition(
        address,
        address,
        uint256,
        bool
    ) external override {
        if (reenterOnOpen) {
            reenterOnOpen = false;
            vault.executeHedge(
                reenterUserId,
                true,
                reenterYuToken,
                1500,
                6500,
                1000,
                1 ether,
                block.timestamp,
                keccak256("reenter")
            );
        }
    }

    function closePosition(address, address) external override {}
}

contract kYUteVaultTest is Test {
    kYUteVault public vault;
    MockERC20 public asset;
    MockBorosRouter public router;

    address public owner = address(0x1);
    address public creOperator = address(0x2);
    address public user = address(0x3);
    address public canonicalUser = address(0x33);
    address public attacker = address(0x4);
    address public liquidityProvider = address(0x5);
    address public ethAsset = address(0x11);
    address public btcAsset = address(0x22);
    address public ethYuToken = address(0x101);
    address public btcYuToken = address(0x202);

    function setUp() public {
        vm.startPrank(owner);
        asset = new MockERC20();
        router = new MockBorosRouter();
        vault = new kYUteVault(asset, creOperator, address(router));
        vm.stopPrank();

        asset.mint(user, 1000 ether);
        asset.mint(liquidityProvider, 2000 ether);

        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, user); // Provide vault with some TVL
        vm.stopPrank();
    }

    function _contains(address[] memory values, address target) internal pure returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == target) return true;
        }
        return false;
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
            uint256 lastUpdate,
            uint256 targetHedgeNotional,
            uint256 currentHedgeNotional,
            bool currentHedgeIsLong,
            bool targetHedgeIsLong
        ) = vault.userPositions(user);
        assertEq(posAsset, address(asset));
        assertEq(isLong, true);
        assertEq(notional, 10 ether);
        assertEq(hasBorosHedge, false);
        assertEq(targetHedgeNotional, 10 ether);
        assertEq(currentHedgeNotional, 0);
        assertEq(currentHedgeIsLong, false);
        assertEq(targetHedgeIsLong, true);
    }

    function test_OpenHyperliquidPosition_Revert_UserIdAlreadyMappedByAnotherUser() public {
        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            10 ether,
            5
        );

        vm.prank(attacker);
        vm.expectRevert(kYUteVault.UserIdAlreadyMapped.selector);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            false,
            5 ether,
            2
        );
    }

    function test_OpenHyperliquidPosition_SameUserCanReuseUserId() public {
        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            10 ether,
            5
        );

        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            false,
            12 ether,
            3
        );

        (
            address posAsset,
            bool isLong,
            uint256 notional,
            uint256 leverage,
            bool hasBorosHedge,
            address yuToken,
            uint256 lastUpdate,
            uint256 targetHedgeNotional,
            uint256 currentHedgeNotional,
            bool currentHedgeIsLong,
            bool targetHedgeIsLong
        ) = vault.userPositions(user);
        assertEq(isLong, false);
        assertEq(notional, 12 ether);
        assertEq(leverage, 3);
        assertEq(targetHedgeNotional, 12 ether);
        assertEq(currentHedgeNotional, 0);
        assertEq(targetHedgeIsLong, true);
        assertEq(vault.userIdToAddress(123), user);
    }

    function test_ExecuteHedge_Success() public {
        test_OpenHyperliquidPosition();
        vm.warp(block.timestamp + 1 hours);

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
            10 ether, // hedgeNotional
            block.timestamp, // fresh oracle timestamp
            mockProof // proofHash
        );

        (, , , , bool hasBorosHedge, address yuToken, , uint256 targetHedgeNotional, uint256 currentHedgeNotional, bool currentHedgeIsLong, bool targetHedgeIsLong) = vault.userPositions(
            user
        );
        assertEq(hasBorosHedge, true);
        assertEq(yuToken, address(0x99));
        assertEq(targetHedgeNotional, 10 ether);
        assertEq(currentHedgeNotional, 10 ether);
        assertEq(currentHedgeIsLong, true);
        assertEq(targetHedgeIsLong, true);
        assertEq(router.openCount(), 1);
        assertEq(router.closeCount(), 0);
    }

    function test_ExecuteHedge_Revert_UserCollateralCapBreach() public {
        vm.startPrank(liquidityProvider);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(1000 ether, liquidityProvider);
        vm.stopPrank();

        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            25 ether,
            5
        );

        vm.warp(block.timestamp + 1 hours);
        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.UserCollateralCapBreach.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            25 ether,
            block.timestamp,
            keccak256("proof-user-cap")
        );
    }

    function test_SyncHyperliquidPosition_UpdatesTargetAndExecuteHedgeIsIdempotent() public {
        test_ExecuteHedge_Success();

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.syncHyperliquidPosition(
            123,
            true,
            10 ether,
            5,
            10 ether,
            true,
            block.timestamp
        );

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            10 ether,
            block.timestamp,
            keccak256("proof-repeat")
        );

        (, , , , bool hasBorosHedge, address yuToken, , , uint256 currentHedgeNotional, bool currentHedgeIsLong, bool targetHedgeIsLong) = vault.userPositions(user);
        assertEq(hasBorosHedge, true);
        assertEq(yuToken, address(0x99));
        assertEq(currentHedgeNotional, 10 ether);
        assertEq(currentHedgeIsLong, true);
        assertEq(targetHedgeIsLong, true);
        assertEq(router.openCount(), 1);
        assertEq(router.closeCount(), 0);
    }

    function test_SyncUserAddress_RemapsUserAndMovesPositionState() public {
        vm.prank(user);
        vault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            10 ether,
            5
        );

        vm.prank(creOperator);
        vault.syncUserAddress(123, canonicalUser);

        assertEq(vault.userIdToAddress(123), canonicalUser);

        (
            address posAsset,
            bool isLong,
            uint256 notional,
            uint256 leverage,
            bool hasBorosHedge,
            address yuToken,
            uint256 lastUpdate,
            uint256 targetHedgeNotional,
            uint256 currentHedgeNotional,
            bool currentHedgeIsLong,
            bool targetHedgeIsLong
        ) = vault.userPositions(canonicalUser);
        assertEq(posAsset, address(asset));
        assertEq(isLong, true);
        assertEq(notional, 10 ether);
        assertEq(leverage, 5);
        assertEq(hasBorosHedge, false);
        assertEq(yuToken, address(0));
        assertGt(lastUpdate, 0);
        assertEq(targetHedgeNotional, 10 ether);
        assertEq(currentHedgeNotional, 0);
        assertEq(currentHedgeIsLong, false);
        assertEq(targetHedgeIsLong, true);

        (address oldAsset,,,,,,,,,,) = vault.userPositions(user);
        assertEq(oldAsset, address(0));
    }

    function test_SyncHyperliquidPosition_BootstrapsPositionForMappedUser() public {
        asset.mint(canonicalUser, 100 ether);
        vm.startPrank(canonicalUser);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(25 ether, canonicalUser);
        vm.stopPrank();

        vm.prank(creOperator);
        vault.syncUserAddress(123, canonicalUser);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(creOperator);
        vault.syncHyperliquidPosition(
            123,
            true,
            6 ether,
            1,
            6 ether,
            true,
            block.timestamp
        );

        (
            address posAsset,
            bool isLong,
            uint256 notional,
            uint256 leverage,
            bool hasBorosHedge,
            address yuToken,
            uint256 lastUpdate,
            uint256 targetHedgeNotional,
            uint256 currentHedgeNotional,
            bool currentHedgeIsLong,
            bool targetHedgeIsLong
        ) = vault.userPositions(canonicalUser);
        assertEq(posAsset, address(asset));
        assertEq(isLong, true);
        assertEq(notional, 6 ether);
        assertEq(leverage, 1);
        assertEq(hasBorosHedge, false);
        assertEq(yuToken, address(0));
        assertEq(lastUpdate, block.timestamp);
        assertEq(targetHedgeNotional, 6 ether);
        assertEq(currentHedgeNotional, 0);
        assertEq(currentHedgeIsLong, false);
        assertEq(targetHedgeIsLong, true);
    }

    function test_SyncHyperliquidPosition_RebalancesExistingHedge() public {
        test_ExecuteHedge_Success();

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.syncHyperliquidPosition(
            123,
            true,
            9 ether,
            5,
            9 ether,
            true,
            block.timestamp
        );

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            9 ether,
            block.timestamp,
            keccak256("proof-rebalance")
        );

        (, , uint256 notional, , bool hasBorosHedge, address yuToken, , uint256 targetHedgeNotional, uint256 currentHedgeNotional, bool currentHedgeIsLong, bool targetHedgeIsLong) = vault.userPositions(user);
        assertEq(notional, 9 ether);
        assertEq(targetHedgeNotional, 9 ether);
        assertEq(hasBorosHedge, true);
        assertEq(yuToken, address(0x99));
        assertEq(currentHedgeNotional, 9 ether);
        assertEq(currentHedgeIsLong, true);
        assertEq(targetHedgeIsLong, true);
        assertEq(router.openCount(), 2);
        assertEq(router.closeCount(), 1);
        assertEq(router.lastAmount(), 9 ether);
    }

    function test_SyncHyperliquidPosition_CanTargetShortYu() public {
        test_OpenHyperliquidPosition();

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.syncHyperliquidPosition(
            123,
            false,
            10 ether,
            5,
            10 ether,
            false,
            block.timestamp
        );

        vm.warp(block.timestamp + 1 minutes);
        vm.prank(creOperator);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            10 ether,
            block.timestamp,
            keccak256("proof-short-target")
        );

        (, bool isLong, , , bool hasBorosHedge, address yuToken, , uint256 targetHedgeNotional, uint256 currentHedgeNotional, bool currentHedgeIsLong, bool targetHedgeIsLong) = vault.userPositions(user);
        assertEq(isLong, false);
        assertEq(hasBorosHedge, true);
        assertEq(yuToken, address(0x99));
        assertEq(targetHedgeNotional, 10 ether);
        assertEq(currentHedgeNotional, 10 ether);
        assertEq(currentHedgeIsLong, false);
        assertEq(targetHedgeIsLong, false);
        assertEq(router.lastIsLong(), false);
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
            10 ether,
            block.timestamp,
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
            11 ether,
            block.timestamp,
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
            10 ether,
            block.timestamp,
            mockProof
        );
    }

    function test_ExecuteHedge_Revert_OracleStaleness() public {
        test_OpenHyperliquidPosition();
        bytes32 mockProof = keccak256("proof");

        vm.warp(block.timestamp + 6 minutes);

        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.OracleStaleness.selector);
        vault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            10 ether,
            block.timestamp - 6 minutes,
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
            10 ether,
            block.timestamp,
            mockProof
        );
    }

    function test_ExecuteHedge_Revert_ReentrancyDuringRouterOpen() public {
        ReentrantBorosRouter reentrantRouter = new ReentrantBorosRouter();

        vm.startPrank(owner);
        kYUteVault reentrantVault = new kYUteVault(
            asset,
            address(reentrantRouter),
            address(reentrantRouter)
        );
        reentrantRouter.setVault(reentrantVault);
        vm.stopPrank();

        vm.startPrank(user);
        asset.approve(address(reentrantVault), type(uint256).max);
        reentrantVault.deposit(100 ether, user);
        reentrantVault.openHyperliquidPosition(
            "",
            123,
            address(asset),
            true,
            10 ether,
            5
        );
        vm.stopPrank();

        reentrantRouter.armReenterOnOpen(123, address(0x77));

        vm.prank(address(reentrantRouter));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        reentrantVault.executeHedge(
            123,
            true,
            address(0x99),
            1500,
            6500,
            1000,
            10 ether,
            block.timestamp,
            keccak256("proof")
        );
    }

    function test_OpenHyperliquidPositionForMarket_TracksMultipleMarkets() public {
        vm.startPrank(user);
        vault.openHyperliquidPositionForMarket("", 123, ethYuToken, ethAsset, true, 10 ether, 5);
        vault.openHyperliquidPositionForMarket("", 123, btcYuToken, btcAsset, false, 2 ether, 3);
        vm.stopPrank();

        address[] memory trackedMarkets = vault.userTrackedMarkets(user);
        assertEq(trackedMarkets.length, 2);
        assertTrue(_contains(trackedMarkets, ethYuToken));
        assertTrue(_contains(trackedMarkets, btcYuToken));

        (
            address ethPosAsset,
            bool ethIsLong,
            uint256 ethNotional,
            ,
            ,
            address ethTrackedYuToken,
            ,
            ,
            ,
            ,
        ) = vault.userMarketPositions(user, ethYuToken);
        assertEq(ethPosAsset, ethAsset);
        assertEq(ethIsLong, true);
        assertEq(ethNotional, 10 ether);
        assertEq(ethTrackedYuToken, ethYuToken);

        (
            address btcPosAsset,
            bool btcIsLong,
            uint256 btcNotional,
            ,
            ,
            address btcTrackedYuToken,
            ,
            ,
            ,
            ,
        ) = vault.userMarketPositions(user, btcYuToken);
        assertEq(btcPosAsset, btcAsset);
        assertEq(btcIsLong, false);
        assertEq(btcNotional, 2 ether);
        assertEq(btcTrackedYuToken, btcYuToken);
    }

    function test_ExecuteHedge_SupportsSimultaneousDualMarkets() public {
        vm.startPrank(user);
        vault.openHyperliquidPositionForMarket("", 123, ethYuToken, ethAsset, true, 10 ether, 5);
        vault.openHyperliquidPositionForMarket("", 123, btcYuToken, btcAsset, false, 2 ether, 3);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(creOperator);
        vault.executeHedge(123, true, ethYuToken, 1500, 6500, 1000, 10 ether, block.timestamp, keccak256("eth-proof"));
        vault.executeHedge(123, true, btcYuToken, 1500, 6500, 1000, 2 ether, block.timestamp, keccak256("btc-proof"));
        vm.stopPrank();

        (
            ,
            ,
            ,
            ,
            bool ethHasBorosHedge,
            address ethTrackedYuToken,
            ,
            ,
            uint256 ethCurrentHedgeNotional,
            bool ethCurrentHedgeIsLong,
            bool ethTargetHedgeIsLong
        ) = vault.userMarketPositions(user, ethYuToken);
        assertTrue(ethHasBorosHedge);
        assertEq(ethTrackedYuToken, ethYuToken);
        assertEq(ethCurrentHedgeNotional, 10 ether);
        assertTrue(ethCurrentHedgeIsLong);
        assertTrue(ethTargetHedgeIsLong);

        (
            ,
            ,
            ,
            ,
            bool btcHasBorosHedge,
            address btcTrackedYuToken,
            ,
            ,
            uint256 btcCurrentHedgeNotional,
            bool btcCurrentHedgeIsLong,
            bool btcTargetHedgeIsLong
        ) = vault.userMarketPositions(user, btcYuToken);
        assertTrue(btcHasBorosHedge);
        assertEq(btcTrackedYuToken, btcYuToken);
        assertEq(btcCurrentHedgeNotional, 2 ether);
        assertTrue(btcCurrentHedgeIsLong);
        assertTrue(btcTargetHedgeIsLong);

        assertEq(router.openCount(), 2);
    }

    function test_ExecuteHedge_Revert_UserCollateralCapBreachAcrossMarkets() public {
        vm.startPrank(liquidityProvider);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(1000 ether, liquidityProvider);
        vm.stopPrank();

        vm.startPrank(user);
        vault.openHyperliquidPositionForMarket("", 123, ethYuToken, ethAsset, true, 60 ether, 5);
        vault.openHyperliquidPositionForMarket("", 123, btcYuToken, btcAsset, true, 50 ether, 5);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);
        vm.prank(creOperator);
        vault.executeHedge(123, true, ethYuToken, 1500, 6500, 1000, 60 ether, block.timestamp, keccak256("eth-cap"));

        vm.prank(creOperator);
        vm.expectRevert(kYUteVault.UserCollateralCapBreach.selector);
        vault.executeHedge(123, true, btcYuToken, 1500, 6500, 1000, 50 ether, block.timestamp, keccak256("btc-cap"));
    }

    function test_CloseAllPositions_ClosesDualMarketHedges() public {
        vm.startPrank(user);
        vault.openHyperliquidPositionForMarket("", 123, ethYuToken, ethAsset, true, 10 ether, 5);
        vault.openHyperliquidPositionForMarket("", 123, btcYuToken, btcAsset, false, 2 ether, 3);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(creOperator);
        vault.executeHedge(123, true, ethYuToken, 1500, 6500, 1000, 10 ether, block.timestamp, keccak256("eth-close"));
        vault.executeHedge(123, true, btcYuToken, 1500, 6500, 1000, 2 ether, block.timestamp, keccak256("btc-close"));
        vm.stopPrank();

        vm.prank(user);
        vault.closeAllPositions(user);

        address[] memory trackedMarkets = vault.userTrackedMarkets(user);
        assertEq(trackedMarkets.length, 0);
        assertEq(router.closeCount(), 2);

        (address clearedEthAsset,,,,,,,,,,) = vault.userMarketPositions(user, ethYuToken);
        (address clearedBtcAsset,,,,,,,,,,) = vault.userMarketPositions(user, btcYuToken);
        assertEq(clearedEthAsset, address(0));
        assertEq(clearedBtcAsset, address(0));
    }
}
