// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import {IReceiver} from "@chainlink/contracts/src/v0.8/shared/interfaces/IReceiver.sol";

contract StabilityVault is Ownable, IReceiver {
    mapping(address => uint256) public balances;
    address public agent; // Keeping the agent for legacy reasons or explicit permission if needed

    event Deposit(address indexed user, uint256 amount);
    event HedgeRecorded(address indexed agent, uint256 amount, uint256 timestamp);

    constructor(address _agent) Ownable(msg.sender) {
        agent = _agent;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Only Agent");
        _;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    // Legacy function, might not be needed anymore, but keeping for backward compatibility
    function recordHedge(uint256 amount) external onlyAgent {
        emit HedgeRecorded(msg.sender, amount, block.timestamp);
    }

    // This is the function the Chainlink network will call via the Keystone Forwarder
    function onReport(bytes calldata /* metadata */, bytes calldata report) external override onlyAgent {
        // 1. Decode the report generated in TypeScript
        (bool executeHedge, uint256 confidence) = abi.decode(report, (bool, uint256));
        
        require(executeHedge, "AI did not approve hedge");
        require(confidence > 80, "AI confidence too low");
        
        // 2. Here we would normally execute the Pendle Deposit
        // In this abstracted example, we just emit the event indicating a successful hedge simulation
        // The real amount and executing logic should be tailored to the Pendle integration.
        // As a placeholder, we use 0.5 ETH as an abstract logged amount for now.
        emit HedgeRecorded(msg.sender, 0.5 ether, block.timestamp);
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId;
    }

    receive() external payable {}
}
