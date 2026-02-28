// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IBorosRouter {
    function openPosition(
        address user,
        address token,
        uint256 amount,
        bool isLong
    ) external;
    function closePosition(address user, address token) external;
}
