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

    // userId is resolved off-chain and synced on-chain; positions are market-scoped by YU token.
    mapping(uint256 => address) public userIdToAddress;
    mapping(address => mapping(address => Position)) public userMarketPositions;
    mapping(address => address[]) private userTrackedYuTokens;
    mapping(address => mapping(address => uint256)) private userTrackedYuTokenIndexPlusOne;

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
    event UserMarketTracked(address indexed user, address indexed yuToken);
    event UserMarketUntracked(address indexed user, address indexed yuToken);

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
    error AmbiguousMarketSelection();

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

    function _isPositionInitialized(Position storage pos) internal view returns (bool) {
        return
            pos.asset != address(0) ||
            pos.notional > 0 ||
            pos.lastUpdateTimestamp > 0 ||
            pos.targetHedgeNotional > 0 ||
            pos.currentHedgeNotional > 0 ||
            pos.hasBorosHedge;
    }

    function _trackUserMarket(address user, address yuToken) internal {
        if (yuToken == address(0) || userTrackedYuTokenIndexPlusOne[user][yuToken] != 0) {
            return;
        }
        userTrackedYuTokens[user].push(yuToken);
        userTrackedYuTokenIndexPlusOne[user][yuToken] = userTrackedYuTokens[user].length;
        emit UserMarketTracked(user, yuToken);
    }

    function _untrackUserMarket(address user, address yuToken) internal {
        uint256 indexPlusOne = userTrackedYuTokenIndexPlusOne[user][yuToken];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = userTrackedYuTokens[user].length - 1;
        if (index != lastIndex) {
            address lastToken = userTrackedYuTokens[user][lastIndex];
            userTrackedYuTokens[user][index] = lastToken;
            userTrackedYuTokenIndexPlusOne[user][lastToken] = index + 1;
        }

        userTrackedYuTokens[user].pop();
        delete userTrackedYuTokenIndexPlusOne[user][yuToken];
        emit UserMarketUntracked(user, yuToken);
    }

    function _selectLatestTrackedYuToken(address user) internal view returns (address) {
        uint256 length = userTrackedYuTokens[user].length;
        if (length == 0) {
            return address(0);
        }
        if (length == 1) {
            return userTrackedYuTokens[user][0];
        }

        address latestToken = address(0);
        uint256 latestTimestamp = 0;
        for (uint256 i = 0; i < length; i++) {
            address candidate = userTrackedYuTokens[user][i];
            Position storage pos = userMarketPositions[user][candidate];
            if (pos.lastUpdateTimestamp >= latestTimestamp) {
                latestTimestamp = pos.lastUpdateTimestamp;
                latestToken = candidate;
            }
        }
        return latestToken;
    }

    function _resolveExistingPositionToken(address user, address preferredYuToken) internal view returns (address) {
        uint256 length = userTrackedYuTokens[user].length;
        if (preferredYuToken != address(0)) {
            Position storage preferred = userMarketPositions[user][preferredYuToken];
            if (_isPositionInitialized(preferred) || userTrackedYuTokenIndexPlusOne[user][preferredYuToken] != 0) {
                return preferredYuToken;
            }
            if (length > 1) {
                revert AmbiguousMarketSelection();
            }
        }
        if (length == 0) {
            return address(0);
        }
        if (length > 1) {
            revert AmbiguousMarketSelection();
        }
        return userTrackedYuTokens[user][0];
    }

    function _sumCurrentHedgeNotional(address user, address exceptYuToken, uint256 replacement) internal view returns (uint256 total) {
        address[] storage tracked = userTrackedYuTokens[user];
        for (uint256 i = 0; i < tracked.length; i++) {
            address marketToken = tracked[i];
            if (marketToken == exceptYuToken) {
                total += replacement;
            } else {
                total += userMarketPositions[user][marketToken].currentHedgeNotional;
            }
        }
    }

    function userTrackedMarkets(address user) external view returns (address[] memory) {
        return userTrackedYuTokens[user];
    }

    function userPositions(address user) external view returns (
        address asset_,
        bool isLong_,
        uint256 notional_,
        uint256 leverage_,
        bool hasBorosHedge_,
        address yuToken_,
        uint256 lastUpdateTimestamp_,
        uint256 targetHedgeNotional_,
        uint256 currentHedgeNotional_,
        bool currentHedgeIsLong_,
        bool targetHedgeIsLong_
    ) {
        address yuToken = _selectLatestTrackedYuToken(user);
        if (yuToken == address(0)) {
            return (address(0), false, 0, 0, false, address(0), 0, 0, 0, false, false);
        }
        Position storage pos = userMarketPositions[user][yuToken];
        return (
            pos.asset,
            pos.isLong,
            pos.notional,
            pos.leverage,
            pos.hasBorosHedge,
            pos.yuToken,
            pos.lastUpdateTimestamp,
            pos.targetHedgeNotional,
            pos.currentHedgeNotional,
            pos.currentHedgeIsLong,
            pos.targetHedgeIsLong
        );
    }

    function openHyperliquidPosition(
        bytes calldata order,
        uint256 userId,
        address asset,
        bool isLong,
        uint256 notional,
        uint256 leverage
    ) external {
        openHyperliquidPositionForMarket(order, userId, asset, asset, isLong, notional, leverage);
    }

    function openHyperliquidPositionForMarket(
        bytes calldata,
        uint256 userId,
        address yuToken,
        address asset,
        bool isLong,
        uint256 notional,
        uint256 leverage
    ) public {
        // In a real implementation we would execute or queue EIP-712 order for off-chain submission
        // For MVP, we simply track the position metadata.
        address mappedUser = userIdToAddress[userId];
        if (mappedUser != address(0) && mappedUser != msg.sender) {
            revert UserIdAlreadyMapped();
        }
        address user = mappedUser == address(0) ? msg.sender : mappedUser;
        userIdToAddress[userId] = user;

        address marketToken = yuToken == address(0) ? asset : yuToken;
        Position storage existing = userMarketPositions[user][marketToken];
        userMarketPositions[user][marketToken] = Position({
            asset: asset,
            isLong: isLong,
            notional: notional,
            leverage: leverage,
            hasBorosHedge: existing.hasBorosHedge,
            yuToken: marketToken,
            lastUpdateTimestamp: block.timestamp,
            targetHedgeNotional: notional,
            currentHedgeNotional: existing.currentHedgeNotional,
            currentHedgeIsLong: existing.currentHedgeIsLong,
            targetHedgeIsLong: existing.targetHedgeIsLong || !existing.hasBorosHedge
        });
        _trackUserMarket(user, marketToken);

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

        address marketToken = _resolveExistingPositionToken(user, address(0));
        if (marketToken == address(0)) {
            revert AmbiguousMarketSelection();
        }
        _syncHyperliquidPositionForMarket(
            userId,
            marketToken,
            isLong,
            notional,
            leverage,
            targetHedgeNotional,
            targetHedgeIsLong,
            oracleTimestamp
        );
    }

    function syncHyperliquidPositionForMarket(
        uint256 userId,
        address yuToken,
        bool isLong,
        uint256 notional,
        uint256 leverage,
        uint256 targetHedgeNotional,
        bool targetHedgeIsLong,
        uint256 oracleTimestamp
    ) external onlyCRE {
        _syncHyperliquidPositionForMarket(
            userId,
            yuToken,
            isLong,
            notional,
            leverage,
            targetHedgeNotional,
            targetHedgeIsLong,
            oracleTimestamp
        );
    }

    function _syncHyperliquidPositionForMarket(
        uint256 userId,
        address yuToken,
        bool isLong,
        uint256 notional,
        uint256 leverage,
        uint256 targetHedgeNotional,
        bool targetHedgeIsLong,
        uint256 oracleTimestamp
    ) internal {
        address user = userIdToAddress[userId];
        require(user != address(0), "User not found");
        require(yuToken != address(0), "Invalid yuToken");

        Position storage pos = userMarketPositions[user][yuToken];

        _validateOracleTimestamp(oracleTimestamp);

        if (pos.asset == address(0)) {
            pos.asset = address(asset());
        }
        pos.yuToken = yuToken;
        pos.isLong = isLong;
        pos.notional = notional;
        pos.leverage = leverage;
        pos.targetHedgeNotional = targetHedgeNotional;
        pos.targetHedgeIsLong = targetHedgeIsLong;
        pos.lastUpdateTimestamp = oracleTimestamp;
        _trackUserMarket(user, yuToken);

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
            address[] memory previousMarkets = userTrackedYuTokens[previousUser];
            address[] storage targetMarkets = userTrackedYuTokens[user];
            if (targetMarkets.length > 0) {
                revert TargetUserAlreadyInitialized();
            }

            for (uint256 i = 0; i < previousMarkets.length; i++) {
                address marketToken = previousMarkets[i];
                Position storage previousPos = userMarketPositions[previousUser][marketToken];
                if (previousPos.hasBorosHedge || previousPos.currentHedgeNotional > 0) {
                    revert ActiveHedgeCannotRemap();
                }
                Position storage targetPos = userMarketPositions[user][marketToken];
                if (_isPositionInitialized(targetPos)) {
                    revert TargetUserAlreadyInitialized();
                }
            }

            for (uint256 i = 0; i < previousMarkets.length; i++) {
                address marketToken = previousMarkets[i];
                Position storage previousPos = userMarketPositions[previousUser][marketToken];
                if (_isPositionInitialized(previousPos)) {
                    userMarketPositions[user][marketToken] = previousPos;
                    delete userMarketPositions[previousUser][marketToken];
                    _trackUserMarket(user, marketToken);
                    _untrackUserMarket(previousUser, marketToken);
                }
            }
        }

        userIdToAddress[userId] = user;
        emit UserAddressSynced(userId, previousUser, user);
    }

    function closeAllPositions(address user) external nonReentrant {
        // Anyone can trigger for themselves, or perhaps an admin unwinds
        require(msg.sender == user || msg.sender == owner(), "Unauthorized");

        address[] memory trackedMarkets = userTrackedYuTokens[user];
        if (trackedMarkets.length == 0) return;

        for (uint256 i = 0; i < trackedMarkets.length; i++) {
            address marketToken = trackedMarkets[i];
            Position storage pos = userMarketPositions[user][marketToken];
            if (!_isPositionInitialized(pos)) {
                continue;
            }

            if (pos.hasBorosHedge) {
                address hedgeToken = pos.yuToken;
                uint256 currentHedgeNotional = pos.currentHedgeNotional;
                pos.hasBorosHedge = false;
                pos.currentHedgeNotional = 0;
                pos.currentHedgeIsLong = false;

                borosRouter.closePosition(user, hedgeToken);
                emit BorosHedgeClosed(user, hedgeToken, currentHedgeNotional);
            }

            emit HyperliquidPositionClosed(user);
            delete userMarketPositions[user][marketToken];
            _untrackUserMarket(user, marketToken);
        }
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
        _executeHedgeForMarket(
            userId,
            yuToken,
            shouldHedge,
            predictedApr,
            confidenceBp,
            borosApr,
            hedgeNotional,
            oracleTimestamp,
            proofHash
        );
    }

    function _executeHedgeForMarket(
        uint256 userId,
        address yuToken,
        bool shouldHedge,
        int256 predictedApr,
        uint256 confidenceBp,
        int256 borosApr,
        uint256 hedgeNotional,
        uint256 oracleTimestamp,
        bytes32 proofHash
    ) internal {
        address user = userIdToAddress[userId];
        require(user != address(0), "User not found");
        address marketToken = _resolveExistingPositionToken(user, yuToken);
        if (marketToken == address(0)) {
            revert AmbiguousMarketSelection();
        }
        Position storage pos = userMarketPositions[user][marketToken];
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
            uint256 aggregateCurrentHedge = _sumCurrentHedgeNotional(user, marketToken, hedgeTarget);
            if (aggregateCurrentHedge > userAssetBalance) {
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
                pos.currentHedgeNotional = 0;
                pos.currentHedgeIsLong = false;

                borosRouter.closePosition(user, hedgeToken);
                emit BorosHedgeClosed(user, hedgeToken, currentHedgeNotional);
            }

            if (!hedgeConfigMatches && hedgeTarget > 0) {
                pos.hasBorosHedge = true;
                pos.yuToken = marketToken;
                pos.currentHedgeNotional = hedgeTarget;
                pos.currentHedgeIsLong = hedgeIsLong;

                borosRouter.openPosition(user, marketToken, hedgeTarget, hedgeIsLong);
                emit BorosHedgeOpened(user, marketToken, hedgeTarget, hedgeIsLong);
            }
        } else if (!shouldHedge && pos.hasBorosHedge) {
            // Close hedge
            address hedgeToken = pos.yuToken;
            uint256 currentHedgeNotional = pos.currentHedgeNotional;
            // Effects before interaction to prevent stale-state reentrancy paths.
            pos.hasBorosHedge = false;
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
