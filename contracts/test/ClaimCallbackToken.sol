// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./MockERC20.sol";

/// @dev Local malicious-token fixture: attempts a callback during token movement.
contract ClaimCallbackToken is MockERC20 {
    address public target;
    bytes public payload;
    bool public callbackSucceeded;
    constructor() MockERC20("Callback test token", "CALL", 6) {}
    function arm(address target_, bytes calldata payload_) external {
        target = target_; payload = payload_; callbackSucceeded = false;
    }
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (target != address(0) && from != address(0)) {
            address callTarget = target;
            target = address(0);
            (callbackSucceeded,) = callTarget.call(payload);
        }
    }
}
