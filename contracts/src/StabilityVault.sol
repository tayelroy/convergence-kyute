// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import {
    IReceiver
} from "@chainlink/contracts/src/v0.8/shared/interfaces/IReceiver.sol";

contract StabilityVault is Ownable, IReceiver {
    mapping(address => uint256) public balances;
    address public agent; // Keeping the agent for legacy reasons or explicit permission if needed

    event Deposit(address indexed user, uint256 amount);
    event ExecutionIntentAuthorized(
        string direction,
        uint256 leverage,
        uint256 confidence,
        uint256 timestamp
    );

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
        emit ExecutionIntentAuthorized("LONG", amount, 100, block.timestamp);
    }

    function onReport(
        bytes calldata /* metadata */,
        bytes calldata report
    ) external override onlyAgent {
        // 1. Decode the report generated in TypeScript
        (string memory direction, uint256 leverage, uint256 confidence) = abi
            .decode(report, (string, uint256, uint256));

        require(
            keccak256(abi.encodePacked(direction)) ==
                keccak256(abi.encodePacked("LONG")) ||
                keccak256(abi.encodePacked(direction)) ==
                keccak256(abi.encodePacked("SHORT")),
            "Target direction must be LONG or SHORT"
        );
        require(confidence > 80, "AI confidence too low");

        // 2. Here we emit the intent for the off-chain relayer to pick up and execute on Hyperliquid/Binance
        emit ExecutionIntentAuthorized(
            direction,
            leverage,
            confidence,
            block.timestamp
        );
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId;
    }

    receive() external payable {}
}
