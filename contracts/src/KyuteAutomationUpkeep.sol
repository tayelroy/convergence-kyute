// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAutomationAgentHook {
    function onAutomationTrigger(bytes calldata performData) external;
}

/// @title KyuteAutomationUpkeep
/// @notice Chainlink Automation-compatible upkeep contract for triggering a configured agent.
/// @dev Upkeep is needed when interval has elapsed or when an owner-set manual trigger flag is active.
contract KyuteAutomationUpkeep is AutomationCompatibleInterface, Ownable, Pausable, ReentrancyGuard {
    address public agent;
    uint256 public upkeepInterval;
    uint256 public lastUpkeepTimestamp;
    bool public manualTriggerRequested;

    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event UpkeepIntervalUpdated(uint256 previousInterval, uint256 newInterval);
    event ManualTriggerUpdated(bool requested);
    event AgentTriggered(address indexed caller, address indexed agent, bytes performData, uint256 timestamp);
    event UpkeepPerformed(address indexed caller, bool usedManualTrigger, uint256 timestamp, bytes performData);

    error InvalidAgent();
    error InvalidInterval();
    error UpkeepNotNeeded();
    error AgentCallFailed(bytes revertData);

    /// @notice Initializes the upkeep contract.
    /// @param initialOwner Owner address for privileged controls.
    /// @param initialAgent Configured agent address (EOA or contract).
    /// @param initialInterval Minimum seconds between upkeep executions.
    constructor(address initialOwner, address initialAgent, uint256 initialInterval) Ownable(initialOwner) {
        if (initialAgent == address(0)) revert InvalidAgent();
        if (initialInterval == 0) revert InvalidInterval();

        agent = initialAgent;
        upkeepInterval = initialInterval;
        lastUpkeepTimestamp = block.timestamp;
    }

    /// @notice Chainlink check hook for upkeep eligibility.
    /// @param checkData Arbitrary check payload supplied at upkeep registration.
    /// @return upkeepNeeded True when upkeep should be performed.
    /// @return performData Data payload passed to performUpkeep.
    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        upkeepNeeded = _isUpkeepNeeded();
        performData = checkData;
    }

    /// @notice Chainlink perform hook; executes trigger path when upkeep is needed.
    /// @param performData Payload forwarded to triggerAgent.
    function performUpkeep(bytes calldata performData) external override whenNotPaused {
        bool wasManualTrigger = manualTriggerRequested;
        if (!_isUpkeepNeeded()) revert UpkeepNotNeeded();

        this.triggerAgent(performData);

        manualTriggerRequested = false;
        lastUpkeepTimestamp = block.timestamp;

        emit UpkeepPerformed(msg.sender, wasManualTrigger, block.timestamp, performData);
    }

    /// @notice Triggers the configured agent and emits proof event.
    /// @dev Callable by contract itself (during upkeep) or owner (manual emergency execution).
    /// @param performData Payload that can be consumed by downstream on-chain hooks.
    function triggerAgent(bytes calldata performData) external nonReentrant whenNotPaused {
        if (msg.sender != address(this) && msg.sender != owner()) revert OwnableUnauthorizedAccount(msg.sender);

        address currentAgent = agent;
        if (currentAgent.code.length > 0) {
            (bool ok, bytes memory ret) = currentAgent.call(
                abi.encodeCall(IAutomationAgentHook.onAutomationTrigger, (performData))
            );
            if (!ok) revert AgentCallFailed(ret);
        }

        emit AgentTriggered(msg.sender, currentAgent, performData, block.timestamp);
    }

    /// @notice Updates the configured agent address.
    /// @param newAgent New agent address.
    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert InvalidAgent();
        address previousAgent = agent;
        agent = newAgent;
        emit AgentUpdated(previousAgent, newAgent);
    }

    /// @notice Updates upkeep interval in seconds.
    /// @param newInterval New interval value in seconds.
    function setUpkeepInterval(uint256 newInterval) external onlyOwner {
        if (newInterval == 0) revert InvalidInterval();
        uint256 previousInterval = upkeepInterval;
        upkeepInterval = newInterval;
        emit UpkeepIntervalUpdated(previousInterval, newInterval);
    }

    /// @notice Sets or clears the manual trigger request flag.
    /// @param requested Boolean indicating whether manual trigger is requested.
    function setManualTrigger(bool requested) external onlyOwner {
        manualTriggerRequested = requested;
        emit ManualTriggerUpdated(requested);
    }

    /// @notice Pauses upkeep and trigger execution.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses upkeep and trigger execution.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Returns whether upkeep can currently execute.
    /// @return True if interval condition or manual trigger is satisfied while unpaused.
    function isUpkeepNeededNow() external view returns (bool) {
        return _isUpkeepNeeded();
    }

    function _isUpkeepNeeded() internal view returns (bool) {
        if (paused()) return false;
        return manualTriggerRequested || block.timestamp >= lastUpkeepTimestamp + upkeepInterval;
    }
}
