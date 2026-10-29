// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Teaching example: no payments, external calls or upgrade mechanism.
contract Counter {
    uint256 public count;
    address public immutable owner;
    event Changed(address indexed caller, uint256 newCount);

    constructor() { owner = msg.sender; }

    function increment() external {
        count += 1;
        emit Changed(msg.sender, count);
    }

    function reset(uint256 newCount) external {
        require(msg.sender == owner, "Only owner may reset");
        require(newCount <= 1_000_000, "Reset value too large");
        count = newCount;
        emit Changed(msg.sender, count);
    }
}
