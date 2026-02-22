// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title KyuteCCIPSender
/// @notice Owner-controlled CCIP sender for arbitrary payloads with LINK fee payments.
/// @dev Uses official Chainlink CCIP router/client interfaces and LINK token interface.
contract KyuteCCIPSender is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IRouterClient public immutable router;
    LinkTokenInterface public immutable linkToken;

    uint64 public destinationChainSelector;
    address public destinationReceiver;
    uint256 public destinationGasLimit;
    bool public allowOutOfOrderExecution;

    event DestinationChainSelectorUpdated(uint64 previousSelector, uint64 newSelector);
    event DestinationReceiverUpdated(address indexed previousReceiver, address indexed newReceiver);
    event DestinationGasLimitUpdated(uint256 previousGasLimit, uint256 newGasLimit);
    event AllowOutOfOrderExecutionUpdated(bool previousValue, bool newValue);
    event CcipMessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed destinationReceiver,
        bytes payload,
        address feeToken,
        uint256 feePaid
    );
    event LinkWithdrawn(address indexed beneficiary, uint256 amount);
    event NativeWithdrawn(address indexed beneficiary, uint256 amount);

    error InvalidAddress();
    error InvalidDestinationChainSelector();
    error InvalidGasLimit();
    error DestinationChainNotSupported(uint64 chainSelector);
    error NotEnoughLinkBalance(uint256 balance, uint256 requiredFee);
    error NativeTransferFailed();

    /// @notice Initializes the sender with router, LINK token and destination defaults.
    /// @param initialOwner Owner address with privileged controls.
    /// @param routerAddress CCIP router address on source chain.
    /// @param linkTokenAddress LINK token address on source chain.
    /// @param initialDestinationChainSelector Destination chain selector for outbound messages.
    /// @param initialDestinationReceiver Receiver contract on destination chain.
    /// @param initialDestinationGasLimit Destination execution gas limit.
    /// @param initialAllowOutOfOrderExecution Whether destination execution may be out-of-order.
    constructor(
        address initialOwner,
        address routerAddress,
        address linkTokenAddress,
        uint64 initialDestinationChainSelector,
        address initialDestinationReceiver,
        uint256 initialDestinationGasLimit,
        bool initialAllowOutOfOrderExecution
    ) Ownable(initialOwner) {
        if (routerAddress == address(0) || linkTokenAddress == address(0)) revert InvalidAddress();
        if (initialDestinationReceiver == address(0)) revert InvalidAddress();
        if (initialDestinationChainSelector == 0) revert InvalidDestinationChainSelector();
        if (initialDestinationGasLimit == 0) revert InvalidGasLimit();

        router = IRouterClient(routerAddress);
        linkToken = LinkTokenInterface(linkTokenAddress);

        destinationChainSelector = initialDestinationChainSelector;
        destinationReceiver = initialDestinationReceiver;
        destinationGasLimit = initialDestinationGasLimit;
        allowOutOfOrderExecution = initialAllowOutOfOrderExecution;
    }

    /// @notice Returns the LINK-denominated fee required for a payload with current destination configuration.
    /// @param payload Arbitrary message payload bytes.
    /// @return fee LINK fee quoted by router.
    function quoteFee(bytes calldata payload) external view returns (uint256 fee) {
        Client.EVM2AnyMessage memory message = _buildMessage(payload);
        return router.getFee(destinationChainSelector, message);
    }

    /// @notice Sends a CCIP message to configured destination using LINK as fee token.
    /// @param payload Arbitrary message payload bytes.
    /// @return messageId CCIP message id returned by router.
    function sendMessage(bytes calldata payload) external onlyOwner whenNotPaused nonReentrant returns (bytes32 messageId) {
        uint64 chainSelector = destinationChainSelector;
        if (!router.isChainSupported(chainSelector)) revert DestinationChainNotSupported(chainSelector);

        Client.EVM2AnyMessage memory message = _buildMessage(payload);
        uint256 fee = router.getFee(chainSelector, message);

        uint256 currentLinkBalance = linkToken.balanceOf(address(this));
        if (currentLinkBalance < fee) revert NotEnoughLinkBalance(currentLinkBalance, fee);

        IERC20(address(linkToken)).forceApprove(address(router), 0);
        IERC20(address(linkToken)).forceApprove(address(router), fee);

        messageId = router.ccipSend(chainSelector, message);

        emit CcipMessageSent(
            messageId,
            chainSelector,
            destinationReceiver,
            payload,
            address(linkToken),
            fee
        );

        return messageId;
    }

    /// @notice Updates destination chain selector.
    /// @param newSelector New destination chain selector.
    function setDestinationChainSelector(uint64 newSelector) external onlyOwner {
        if (newSelector == 0) revert InvalidDestinationChainSelector();
        uint64 previousSelector = destinationChainSelector;
        destinationChainSelector = newSelector;
        emit DestinationChainSelectorUpdated(previousSelector, newSelector);
    }

    /// @notice Updates destination receiver address.
    /// @param newReceiver New destination receiver address.
    function setDestinationReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert InvalidAddress();
        address previousReceiver = destinationReceiver;
        destinationReceiver = newReceiver;
        emit DestinationReceiverUpdated(previousReceiver, newReceiver);
    }

    /// @notice Updates destination execution gas limit.
    /// @param newGasLimit New destination gas limit.
    function setDestinationGasLimit(uint256 newGasLimit) external onlyOwner {
        if (newGasLimit == 0) revert InvalidGasLimit();
        uint256 previousGasLimit = destinationGasLimit;
        destinationGasLimit = newGasLimit;
        emit DestinationGasLimitUpdated(previousGasLimit, newGasLimit);
    }

    /// @notice Updates out-of-order execution setting.
    /// @param newValue New out-of-order execution flag.
    function setAllowOutOfOrderExecution(bool newValue) external onlyOwner {
        bool previousValue = allowOutOfOrderExecution;
        allowOutOfOrderExecution = newValue;
        emit AllowOutOfOrderExecutionUpdated(previousValue, newValue);
    }

    /// @notice Pauses outbound message sends.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses outbound message sends.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraws LINK from this contract.
    /// @param beneficiary Receiver of LINK tokens.
    /// @param amount Amount of LINK to withdraw.
    function withdrawLink(address beneficiary, uint256 amount) external onlyOwner nonReentrant {
        if (beneficiary == address(0)) revert InvalidAddress();
        IERC20(address(linkToken)).safeTransfer(beneficiary, amount);
        emit LinkWithdrawn(beneficiary, amount);
    }

    /// @notice Withdraws native token balance from this contract.
    /// @param beneficiary Receiver of native token.
    /// @param amount Amount of native token to withdraw.
    function withdrawNative(address payable beneficiary, uint256 amount) external onlyOwner nonReentrant {
        if (beneficiary == address(0)) revert InvalidAddress();
        (bool ok,) = beneficiary.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit NativeWithdrawn(beneficiary, amount);
    }

    /// @notice Accepts native token transfers.
    receive() external payable {}

    function _buildMessage(bytes calldata payload) internal view returns (Client.EVM2AnyMessage memory message) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](0);
        message = Client.EVM2AnyMessage({
            receiver: abi.encode(destinationReceiver),
            data: payload,
            tokenAmounts: tokenAmounts,
            extraArgs: Client._argsToBytes(
                Client.GenericExtraArgsV2({
                    gasLimit: destinationGasLimit,
                    allowOutOfOrderExecution: allowOutOfOrderExecution
                })
            ),
            feeToken: address(linkToken)
        });
    }
}
