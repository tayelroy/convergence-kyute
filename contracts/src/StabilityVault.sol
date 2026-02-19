// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

contract StabilityVault is Ownable {
    mapping(address => uint256) public balances;
    address public agent;

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

    function recordHedge(uint256 amount) external onlyAgent {
        emit HedgeRecorded(msg.sender, amount, block.timestamp);
    }

    receive() external payable {}
}
