// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IBorosRouter.sol";

contract kYUteVault is ERC4626, Ownable {
    address public creCallbackOperator;
    IBorosRouter public borosRouter;

    // Spec requires max 10% TVL per hedge (1000 basis points)
    uint256 public constant MAX_TVL_HEDGE_BP = 1000;
    // Spec requires confidence >= 60% (6000 basis points)
    uint256 public constant MIN_CONFIDENCE_BP = 6000;
    // Spec requires 0.1% fee buffer (10 basis points)
    uint256 public constant FEE_BUFFER_BP = 10;

    struct Position {
        address asset;
        bool isLong;
        uint256 notional;
        uint256 leverage;
        bool hasBorosHedge;
        address yuToken;
        uint256 lastUpdateTimestamp;
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
    event BorosHedgeOpened(
        address indexed user,
        address yuToken,
        uint256 amount,
        bool isLong
    );
    event BorosHedgeClosed(address indexed user, address yuToken);
    event HedgeDecision(
        bytes32 proofHash,
        uint256 predictedApr,
        uint256 confidenceBp,
        bool hedged
    );

    error OracleStaleness(); // > 5m
    error TvlCapBreach();
    error InsufficientConfidence();
    error FeeBufferNotMet();
    error OnlyCRE();

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
        userIdToAddress[userId] = msg.sender;

        userPositions[msg.sender] = Position({
            asset: asset,
            isLong: isLong,
            notional: notional,
            leverage: leverage,
            hasBorosHedge: false,
            yuToken: address(0),
            lastUpdateTimestamp: block.timestamp
        });

        emit HyperliquidPositionOpened(
            userId,
            msg.sender,
            asset,
            isLong,
            notional,
            leverage
        );
    }

    function closeAllPositions(address user) external {
        // Anyone can trigger for themselves, or perhaps an admin unwinds
        require(msg.sender == user || msg.sender == owner(), "Unauthorized");

        Position storage pos = userPositions[user];
        if (pos.notional == 0) return;

        // Note: the off-chain system should be notified to close Hyperliquid position.

        if (pos.hasBorosHedge) {
            borosRouter.closePosition(user, pos.yuToken);
            emit BorosHedgeClosed(user, pos.yuToken);
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
        bytes32 proofHash
    ) external onlyCRE {
        address user = userIdToAddress[userId];
        require(user != address(0), "User not found");

        Position storage pos = userPositions[user];
        require(pos.notional > 0, "No open position");

        // 1. Check Oracle Staleness Guard (>5m)
        if (block.timestamp > pos.lastUpdateTimestamp + 5 minutes) {
            revert OracleStaleness();
        }

        // 2. Confidence Guard
        if (confidenceBp < MIN_CONFIDENCE_BP) {
            revert InsufficientConfidence();
        }

        // 3. Check TVL per hedge cap (10%)
        // Notional should not exceed 10% of vault's totalAssets
        uint256 vaultTvl = totalAssets();
        if (pos.notional > (vaultTvl * MAX_TVL_HEDGE_BP) / 10000) {
            revert TvlCapBreach();
        }

        // 4. Calculate buffer constraint (predicted APR must outpace Boros APR by > 0.1%)
        // APRs in basis points maybe? Or actual %. As per spec: predicted savings > 0.1% buffer
        // E.g. predictedApr (bp) - borosApr (bp) > 10 (FEE_BUFFER_BP = 10 bp = 0.1%)
        if (shouldHedge) {
            if (predictedApr <= borosApr + int256(FEE_BUFFER_BP)) {
                revert FeeBufferNotMet();
            }
        }

        // Execution
        if (shouldHedge && !pos.hasBorosHedge) {
            // Open hedge
            // Long HL -> open Long YU; Short HL -> open Short YU
            bool hedgeIsLong = pos.isLong;

            borosRouter.openPosition(user, yuToken, pos.notional, hedgeIsLong);
            pos.hasBorosHedge = true;
            pos.yuToken = yuToken;

            emit BorosHedgeOpened(user, yuToken, pos.notional, hedgeIsLong);
        } else if (!shouldHedge && pos.hasBorosHedge) {
            // Close hedge
            borosRouter.closePosition(user, pos.yuToken);
            pos.hasBorosHedge = false;

            emit BorosHedgeClosed(user, pos.yuToken);
        }

        // Update timestamp to allow subsequent checks
        pos.lastUpdateTimestamp = block.timestamp;

        emit HedgeDecision(
            proofHash,
            uint256(predictedApr > 0 ? predictedApr : -predictedApr),
            confidenceBp,
            shouldHedge
        );
    }
}
