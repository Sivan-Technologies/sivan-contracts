// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Test-only wallet: exercises contract-party calls and ERC1271, not a production multisig.
contract MilestoneTestWallet is IERC1271 {
    address public immutable signer;
    constructor(address signer_) { signer = signer_; }
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == signer, "Only signer");
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && recovered == signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// Test-only token: optional blocked recipient and attempted transfer callback.
contract MilestoneAdversarialToken is ERC20 {
    address public blocked;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bool public callbackAttempted;
    bool private insideCallback;
    constructor() ERC20("Adversarial test token", "TEST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address recipient) external { blocked = recipient; }
    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target; callbackData = data;
        callbackSucceeded = false; callbackAttempted = false;
    }
    function _update(address from, address to, uint256 amount) internal override {
        require(to != blocked || blocked == address(0), "Recipient blocked");
        super._update(from, to, amount);
        if (from != address(0) && callbackTarget != address(0) && !insideCallback) {
            insideCallback = true;
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
            insideCallback = false;
        }
    }
}
