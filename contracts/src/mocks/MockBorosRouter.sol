// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IBorosRouter.sol";

/**
 * @dev Minimal Boros router mock for local Anvil demos.
 *      Stores last call parameters for lightweight verification.
 */
contract MockBorosRouter is IBorosRouter {
    struct Position {
        uint256 amount;
        bool isLong;
    }

    struct Call {
        address user;
        address token;
        uint256 amount;
        bool isLong;
    }

    Call public lastOpen;
    Call public lastClose;
    mapping(address => mapping(address => Position)) private positions;

    event MockOpen(address indexed user, address indexed token, uint256 amount, bool isLong);
    event MockClose(address indexed user, address indexed token);
    event PositionOpened(address indexed user, address indexed token, uint256 amount, bool isLong);
    event PositionClosed(address indexed user, address indexed token);

    function openPosition(
        address user,
        address token,
        uint256 amount,
        bool isLong
    ) external override {
        lastOpen = Call(user, token, amount, isLong);
        positions[user][token] = Position(amount, isLong);
        emit MockOpen(user, token, amount, isLong);
        emit PositionOpened(user, token, amount, isLong);
    }

    function closePosition(address user, address token) external override {
        lastClose = Call(user, token, 0, false);
        delete positions[user][token];
        emit MockClose(user, token);
        emit PositionClosed(user, token);
    }

    function getPosition(address user, address token) external view returns (uint256 amount, bool isLong) {
        Position memory pos = positions[user][token];
        return (pos.amount, pos.isLong);
    }
}
