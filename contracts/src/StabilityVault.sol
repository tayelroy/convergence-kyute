// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title StabilityVault
 * @dev A simplified vault for kYUte users to deposit savings (e.g. USDe/USDC).
 *      Allows an authorized "Agent" (Chainlink CRE) to execute hedging transactions
 *      on behalf of users to protect yield.
 */
contract StabilityVault {
    // --- State Variables ---
    mapping(address => uint256) public balances; // User ETH/Native balance
    address public agent; // The CRE Agent address authorized to hedge
    address public owner;

    // --- Events ---
    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event HedgeExecuted(uint256 amount, string reason);

    // --- Modifiers ---
    modifier onlyOwner() {
        require(msg.sender == owner, "Only Owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Only Agent");
        _;
    }

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    // --- User Actions ---

    /**
     * @notice Deposit native currency (ETH) into the vault.
     * @dev Keeps track of user balance for dashboard display.
     */
    function deposit() external payable {
        require(msg.value > 0, "Deposit must be > 0");
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw native currency.
     */
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit Withdrawal(msg.sender, amount);
    }

    // --- Agent Actions (CRE) ---

    /**
     * @notice Execute a hedge transaction (Draft).
     * @dev In a real implementation, this would interact with Boros Router
     *      to open a Short YU position using the vault's capital.
     *      For hackathon demo, we emit an event to simulate the action.
     * @param amount Amount of capital to deploy into the hedge.
     */
    function openShortYU(uint256 amount) external onlyAgent {
        // Validation (Mock)
        require(
            address(this).balance >= amount,
            "Vault insufficient funds for hedge"
        );

        // Interaction (Mock)
        // In prod: BorosRouter.swap(...)

        emit HedgeExecuted(amount, "High Volatility Projected by AI");
    }

    // --- Admin ---

    function setAgent(address _agent) external onlyOwner {
        address oldAgent = agent;
        agent = _agent;
        emit AgentUpdated(oldAgent, _agent);
    }
}
