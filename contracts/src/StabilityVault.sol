// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

// --- 1. Real Interfaces for Pendle/Boros ---
interface IPendleRouter {
    struct ApproxParams {
        uint256 guessMin;
        uint256 guessMax;
        uint256 guessOffchain;
        uint256 maxIteration;
        uint256 eps;
    }

    struct TokenInput {
        address tokenIn;
        uint256 netTokenIn;
        address tokenMintSy;
        address pendleSwap;
        bytes swapData;
    }

    struct LimitOrderData {
        address limitRouter;
        uint256 epsSkipMarket;
        uint256 normalFills;
        uint256 flashFills;
        bytes optData;
    }

    // The function to "Short Yield" (Buy PT = Fix Yield)
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        ApproxParams calldata guessPtOut,
        TokenInput calldata input,
        LimitOrderData calldata limit
    ) external payable returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);
}

contract StabilityVault is Ownable {
    // --- Configuration (Arbitrum One) ---
    // The Official Pendle Router V3
    address public constant PENDLE_ROUTER = 0x888888888889758F76e7103c6CbF23ABbF58F946;

    // State
    mapping(address => uint256) public balances;
    address public agent;

    event Deposit(address indexed user, uint256 amount);
    event HedgeExecuted(uint256 amountIn, uint256 ptReceived, address market);

    constructor(address _agent) Ownable(msg.sender) {
        agent = _agent;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Only Agent");
        _;
    }

    // --- User Actions ---
    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // --- The "Legit" Hedge Function ---
    /**
     * @notice Converts Vault Capital -> Fixed Yield PT (Shorting Floating Rate)
     * @param market The Boros/Pendle Market address (e.g., PT-eETH-Dec26)
     * @param amount The amount of ETH to deploy
     */
    function openShortYU(address market, uint256 amount) external onlyAgent {
        require(address(this).balance >= amount, "Insufficient Funds");

        // 1. Setup Swap Params (ETH -> PT)
        IPendleRouter.ApproxParams memory emptyApprox = IPendleRouter.ApproxParams(0, 0, 0, 0, 0);
        IPendleRouter.LimitOrderData memory emptyLimit = IPendleRouter.LimitOrderData(address(0), 0, 0, 0, "");

        IPendleRouter.TokenInput memory input = IPendleRouter.TokenInput({
            tokenIn: address(0), // ETH
            netTokenIn: amount,
            tokenMintSy: address(0),
            pendleSwap: address(0),
            swapData: ""
        });

        // 2. Execute Real Swap on Pendle Router
        (uint256 netPtOut, , ) = IPendleRouter(PENDLE_ROUTER).swapExactTokenForPt{value: amount}(
            address(this),
            market,
            0,             // Slippage set to 0 for demo simplicity
            emptyApprox,
            input,
            emptyLimit
        );

        emit HedgeExecuted(amount, netPtOut, market);
    }

    receive() external payable {}
}
