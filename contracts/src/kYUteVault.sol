// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBorosRouter.sol";

contract kYUteVault is ERC4626, Ownable, ReentrancyGuard {
    address public creCallbackOperator;
    IBorosRouter public borosRouter;

    // Spec requires max 10% TVL per hedge (1000 basis points)
    uint256 public constant MAX_TVL_HEDGE_BP = 1000;
    // Spec requires confidence >= 60% (6000 basis points)
    uint256 public constant MIN_CONFIDENCE_BP = 6000;
    // Spec requires 0.1% fee buffer (10 basis points)
    uint256 public constant FEE_BUFFER_BP = 10;
    // Oracle inputs must be no older than 5 minutes.
    uint256 public constant MAX_ORACLE_DELAY = 5 minutes;

    struct Position {
        address asset;
        bool isLong;
        uint256 notional;
        uint256 leverage;
        bool hasBorosHedge;
        address yuToken;
        uint256 lastUpdateTimestamp;
        uint256 targetHedgeNotional;
        uint256 currentHedgeNotional;
        bool currentHedgeIsLong;
        bool targetHedgeIsLong;
    }

    // Spec mentions a per-user userId -> Position mapping, and address user mapping
    // We will map userId to address, and address to Position
    mapping(uint256 => address) public userIdToAddress;
    mapping(address => Position) public userPositions;

    event HyperliquidPositionOpened(
        uint256 indexed userId,
        address user,
        address asset,
        bool isLong,
        uint256 notional,
        uint256 leverage
    );
    event HyperliquidPositionClosed(address indexed user);
    event HyperliquidPositionSynced(
        uint256 indexed userId,
        address user,
        bool isLong,
        uint256 notional,
        uint256 leverage,
        uint256 targetHedgeNotional,
        bool targetHedgeIsLong
    );
    event BorosHedgeOpened(
        address indexed user,
        address yuToken,
        uint256 amount,
        bool isLong
    );
    event BorosHedgeClosed(address indexed user, address yuToken, uint256 amount);
    event HedgeDecision(
        bytes32 proofHash,
        uint256 predictedApr,
        uint256 confidenceBp,
        bool hedged
    );
    event UserAddressSynced(
        uint256 indexed userId,
        address previousUser,
        address user
    );

    error OracleStaleness(); // > 5m
    error TvlCapBreach();
    error InsufficientConfidence();
    error FeeBufferNotMet();
    error OnlyCRE();
    error UserIdAlreadyMapped();
    error HedgeTargetMismatch();
    error UserCollateralCapBreach();
    error ActiveHedgeCannotRemap();
    error TargetUserAlreadyInitialized();

    modifier onlyCRE() {
        if (msg.sender != creCallbackOperator) revert OnlyCRE();
        _;
    }

    constructor(
        IERC20 asset,
        address _creCallbackOperator,
        address _borosRouter
    ) ERC4626(asset) ERC20("kYUte Vault Receipt", "kYUte") Ownable(msg.sender) {
        creCallbackOperator = _creCallbackOperator;
        borosRouter = IBorosRouter(_borosRouter);
    }

    function setCRECallbackOperator(address _operator) external onlyOwner {
        creCallbackOperator = _operator;
    }

    function setBorosRouter(address _router) external onlyOwner {
        borosRouter = IBorosRouter(_router);
    }

    function _validateOracleTimestamp(uint256 oracleTimestamp) internal view {
        if (
            oracleTimestamp > block.timestamp ||
            block.timestamp - oracleTimestamp > MAX_ORACLE_DELAY
        ) {
            revert OracleStaleness();
        }
    }

    function openHyperliquidPosition(
        bytes calldata order,
        uint256 userId,
        address asset,
        bool isLong,
        uint256 notional,
        uint256 leverage
    ) external {
        // In a real implementation we would execute or queue EIP-712 order for off-chain submission
        // For MVP, we simply track the position metadata.
        address mappedUser = userIdToAddress[userId];
        if (mappedUser != address(0) && mappedUser != msg.sender) {
            revert UserIdAlreadyMapped();
        }
        address user = mappedUser == address(0) ? msg.sender : mappedUser;
        userIdToAddress[userId] = user;

        Position storage existing = userPositions[user];
        userPositions[user] = Position({
            asset: asset,
            isLong: isLong,
            notional: notional,
            leverage: leverage,
            hasBorosHedge: existing.hasBorosHedge,
            yuToken: existing.yuToken,
            lastUpdateTimestamp: block.timestamp,
            targetHedgeNotional: notional,
            currentHedgeNotional: existing.currentHedgeNotional,
            currentHedgeIsLong: existing.currentHedgeIsLong,
            targetHedgeIsLong: existing.targetHedgeIsLong || !existing.hasBorosHedge
        });

        emit HyperliquidPositionOpened(
            userId,
            user,
            asset,
            isLong,
            notional,
            leverage
        );
    }

    function syncHyperliquidPosition(
        uint256 userId,
        bool isLong,
        uint256 notional,
        uint256 leverage,
        uint256 targetHedgeNotional,
        bool targetHedgeIsLong,
        uint256 oracleTimestamp
    ) external onlyCRE {
        address user = userIdToAddress[userId];
        require(user != address(0), "User not found");

        Position storage pos = userPositions[user];

        _validateOracleTimestamp(oracleTimestamp);

        if (pos.asset == address(0)) {
            pos.asset = address(asset());
        }
        pos.isLong = isLong;
        pos.notional = notional;
        pos.leverage = leverage;
        pos.targetHedgeNotional = targetHedgeNotional;
        pos.targetHedgeIsLong = targetHedgeIsLong;
        pos.lastUpdateTimestamp = oracleTimestamp;

        emit HyperliquidPositionSynced(
            userId,
            user,
            isLong,
            notional,
            leverage,
            targetHedgeNotional,
            targetHedgeIsLong
        );
    }

    function syncUserAddress(uint256 userId, address user) external onlyCRE {
        require(user != address(0), "User not found");

        address previousUser = userIdToAddress[userId];
        if (previousUser == user) {
            return;
        }

        if (previousUser != address(0)) {
            Position storage previousPos = userPositions[previousUser];
            if (
                previousPos.hasBorosHedge ||
                previousPos.currentHedgeNotional > 0
            ) {
                revert ActiveHedgeCannotRemap();
            }

            Position storage targetPos = userPositions[user];
            if (
                targetPos.asset != address(0) ||
                targetPos.notional > 0 ||
                targetPos.lastUpdateTimestamp > 0
            ) {
                revert TargetUserAlreadyInitialized();
            }

            if (
                previousPos.asset != address(0) ||
                previousPos.notional > 0 ||
                previousPos.lastUpdateTimestamp > 0 ||
                previousPos.targetHedgeNotional > 0 ||
                previousPos.currentHedgeNotional > 0
            ) {
                userPositions[user] = previousPos;
                delete userPositions[previousUser];
            }
        }

        userIdToAddress[userId] = user;
        emit UserAddressSynced(userId, previousUser, user);
    }

    function closeAllPositions(address user) external nonReentrant {
        // Anyone can trigger for themselves, or perhaps an admin unwinds
        require(msg.sender == user || msg.sender == owner(), "Unauthorized");

        Position storage pos = userPositions[user];
        if (pos.notional == 0) return;

        // Note: the off-chain system should be notified to close Hyperliquid position.

        if (pos.hasBorosHedge) {
            address hedgeToken = pos.yuToken;
            uint256 currentHedgeNotional = pos.currentHedgeNotional;
            // Effects before interaction to prevent stale-state reentrancy paths.
            pos.hasBorosHedge = false;
            pos.yuToken = address(0);
            pos.currentHedgeNotional = 0;
            pos.currentHedgeIsLong = false;

            borosRouter.closePosition(user, hedgeToken);
            emit BorosHedgeClosed(user, hedgeToken, currentHedgeNotional);
        }

        emit HyperliquidPositionClosed(user);

        delete userPositions[user];
    }

    function executeHedge(
        uint256 userId,
        bool shouldHedge,
        address yuToken,
        int256 predictedApr,
        uint256 confidenceBp,
        int256 borosApr,
        uint256 hedgeNotional,
        uint256 oracleTimestamp,
        bytes32 proofHash
    ) external onlyCRE nonReentrant {
        address user = userIdToAddress[userId];
        require(user != address(0), "User not found");

        Position storage pos = userPositions[user];
        require(pos.notional > 0, "No open position");

        // 1. Check Oracle Staleness Guard (>5m)
        _validateOracleTimestamp(oracleTimestamp);

        // 2. Confidence Guard
        if (confidenceBp < MIN_CONFIDENCE_BP) {
            revert InsufficientConfidence();
        }

        uint256 hedgeTarget = pos.targetHedgeNotional;
        if (hedgeNotional != 0 && hedgeNotional != hedgeTarget) {
            revert HedgeTargetMismatch();
        }

        // 4. Calculate buffer constraint (predicted APR must outpace Boros APR by > 0.1%)
        // APRs in basis points maybe? Or actual %. As per spec: predicted savings > 0.1% buffer
        // E.g. predictedApr (bp) - borosApr (bp) > 10 (FEE_BUFFER_BP = 10 bp = 0.1%)
        if (shouldHedge) {
            // Notional should not exceed 10% of vault TVL and must fit inside the user's ERC4626 balance.
            uint256 vaultTvl = totalAssets();
            if (hedgeTarget > (vaultTvl * MAX_TVL_HEDGE_BP) / 10000) {
                revert TvlCapBreach();
            }

            uint256 userAssetBalance = convertToAssets(balanceOf(user));
            if (hedgeTarget > userAssetBalance) {
                revert UserCollateralCapBreach();
            }

            if (predictedApr <= borosApr + int256(FEE_BUFFER_BP)) {
                revert FeeBufferNotMet();
            }
        }

        // Execution
        if (shouldHedge) {
            bool hedgeIsLong = pos.targetHedgeIsLong;
            bool hedgeConfigMatches =
                pos.hasBorosHedge &&
                pos.yuToken == yuToken &&
                pos.currentHedgeNotional == hedgeTarget &&
                pos.currentHedgeIsLong == hedgeIsLong;

            if (pos.hasBorosHedge && !hedgeConfigMatches) {
                address hedgeToken = pos.yuToken;
                uint256 currentHedgeNotional = pos.currentHedgeNotional;

                pos.hasBorosHedge = false;
                pos.yuToken = address(0);
                pos.currentHedgeNotional = 0;
                pos.currentHedgeIsLong = false;

                borosRouter.closePosition(user, hedgeToken);
                emit BorosHedgeClosed(user, hedgeToken, currentHedgeNotional);
            }

            if (!hedgeConfigMatches && hedgeTarget > 0) {
                pos.hasBorosHedge = true;
                pos.yuToken = yuToken;
                pos.currentHedgeNotional = hedgeTarget;
                pos.currentHedgeIsLong = hedgeIsLong;

                borosRouter.openPosition(user, yuToken, hedgeTarget, hedgeIsLong);
                emit BorosHedgeOpened(user, yuToken, hedgeTarget, hedgeIsLong);
            }
        } else if (!shouldHedge && pos.hasBorosHedge) {
            // Close hedge
            address hedgeToken = pos.yuToken;
            uint256 currentHedgeNotional = pos.currentHedgeNotional;
            // Effects before interaction to prevent stale-state reentrancy paths.
            pos.hasBorosHedge = false;
            pos.yuToken = address(0);
            pos.currentHedgeNotional = 0;
            pos.currentHedgeIsLong = false;

            borosRouter.closePosition(user, hedgeToken);

            emit BorosHedgeClosed(user, hedgeToken, currentHedgeNotional);
        }

        // Persist the latest oracle observation timestamp.
        pos.lastUpdateTimestamp = oracleTimestamp;

        emit HedgeDecision(
            proofHash,
            uint256(predictedApr > 0 ? predictedApr : -predictedApr),
            confidenceBp,
            shouldHedge
        );
    }
}
