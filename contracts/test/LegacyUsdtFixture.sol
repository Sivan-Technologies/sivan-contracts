// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

/// @dev LOCAL TEST FIXTURE ONLY. Not Tether-issued and never a deployment token.
/// Models empty return data, zero-first approvals and recipient blocking.
/// Does not reproduce every USDT deployment, proxy, fee or issuer mechanism.
contract LegacyUsdtFixture is MockERC20 {
    address public blocked;
    constructor() MockERC20("Local legacy USDT fixture", "USDT", 6) {}
    function setBlocked(address recipient) external { blocked = recipient; }
    function approve(address spender, uint256 amount) public override returns (bool) {
        require(amount == 0 || allowance(msg.sender, spender) == 0, "Reset allowance first");
        super.approve(spender, amount);
        assembly { return(0, 0) }
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(to != blocked, "Recipient blocked");
        super.transfer(to, amount);
        assembly { return(0, 0) }
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(to != blocked, "Recipient blocked");
        super.transferFrom(from, to, amount);
        assembly { return(0, 0) }
    }
}
