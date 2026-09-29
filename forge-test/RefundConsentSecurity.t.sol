// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SivanAgreementVault.sol";
import "../contracts/test/MockERC20.sol";

contract RefundConsentSecurityTest is Test {
    SivanAgreementVault vault;
    MockERC20 token;
    address buyer = address(0xB001);
    uint256 constant CONTRACTOR_KEY = 0xC001;
    address contractor;
    bytes32 id;

    function setUp() public {
        contractor = vm.addr(CONTRACTOR_KEY);
        token = new MockERC20("Test USDC", "USDC", 6);
        vault = new SivanAgreementVault(address(0xFEE), address(0xA6E7), 9827, address(this));
        vault.setSupportedToken(address(token), true);
        id = vault.deriveAgreementId(buyer, bytes12(uint96(1)));
    }

    function fund(uint256 amount, uint256 hours_) internal {
        vm.prank(buyer);
        vault.proposeArbitrationTerms(id, contractor, address(0xBACC), 3 days,
            keccak256(abi.encode(address(token), amount, hours_, address(0))), block.timestamp + 1 days);
        bytes32 terms = vault.arbitrationTermsHash(buyer, id);
        vm.prank(contractor);
        vault.acceptArbitrationTerms(buyer, id, terms, true);
        token.mint(buyer, amount);
        vm.startPrank(buyer);
        token.approve(address(vault), amount);
        vault.deposit(id, contractor, address(token), amount, hours_, address(0));
        vm.stopPrank();
    }

    function sign(uint256 expiry) internal view returns (bytes memory) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Sivan Celo Settlement Facility"), keccak256("1"), block.chainid, address(vault)));
        bytes32 message = keccak256(abi.encode(vault.CONTRACTOR_CONSENT_TYPEHASH(), id,
            vault.refundConsentNonces(id), expiry));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CONTRACTOR_KEY, keccak256(abi.encodePacked("\x19\x01", domain, message)));
        return abi.encodePacked(r, s, v);
    }

    function testFuzz_buyerCannotAccelerateDeadline(uint96 amount_, uint16 hours_) public {
        uint256 amount = bound(amount_, 1, 1e15);
        uint256 hoursValue = bound(hours_, 1, 720);
        fund(amount, hoursValue);
        uint256 deadline = vault.getAgreement(id).refundUnlockAt;
        vm.prank(buyer);
        vm.expectRevert("Only contractor can mark delivery");
        vault.markDelivered(id, "false claim");
        assertEq(vault.getAgreement(id).refundUnlockAt, deadline);
        vm.warp(deadline);
        vm.prank(buyer);
        vm.expectRevert("Refund is not yet unlocked");
        vault.refundBuyer(id);
        vm.warp(deadline + 1);
        vm.prank(buyer);
        vault.refundBuyer(id);
        assertEq(token.balanceOf(buyer), amount);
    }

    function testFuzz_refundConservesFundsInEveryActiveState(uint96 amount_, uint8 state_, uint32 lifetime_) public {
        uint256 amount = bound(amount_, 1, 1e15);
        uint256 state = state_ % 3;
        fund(amount, 720);
        if (state > 0) { vm.prank(contractor); vault.markDelivered(id, "proof"); }
        if (state > 1) { vm.prank(buyer); vault.raiseDispute(id, "disputed"); }
        uint256 expiry = block.timestamp + bound(lifetime_, 1, 1 days);
        uint256 nonce = vault.refundConsentNonces(id);
        bytes memory signature = sign(expiry);
        vault.pause();
        vault.mutualRefundWithConsent(id, expiry, signature);
        assertEq(token.balanceOf(buyer), amount);
        assertEq(token.balanceOf(contractor), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.refundConsentNonces(id), nonce + 1);
        vm.expectRevert("Cannot refund in current state");
        vault.mutualRefundWithConsent(id, expiry, signature);
    }

    function testFuzz_expiredOrRevokedConsentCannotMoveFunds(uint96 amount_, uint32 lifetime_, bool cancel) public {
        uint256 amount = bound(amount_, 1, 1e15);
        fund(amount, 720);
        uint256 expiry = block.timestamp + bound(lifetime_, 1, 1 days);
        bytes memory signature = sign(expiry);
        if (cancel) {
            vm.prank(contractor); vault.invalidateRefundConsent(id);
            vm.expectRevert("Contractor refund consent required");
        } else {
            vm.warp(expiry + 1);
            vm.expectRevert("Invalid refund consent expiry");
        }
        vault.mutualRefundWithConsent(id, expiry, signature);
        assertEq(token.balanceOf(address(vault)), amount);
        assertEq(token.balanceOf(buyer), 0);
    }

    function testFuzz_newBusinessStateInvalidatesConsent(uint96 amount_, bool dispute) public {
        uint256 amount = bound(amount_, 1, 1e15);
        fund(amount, 720);
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory signature = sign(expiry);
        vm.prank(contractor);
        if (dispute) vault.raiseDispute(id, "dispute");
        else vault.markDelivered(id, "proof");
        vm.expectRevert("Contractor refund consent required");
        vault.mutualRefundWithConsent(id, expiry, signature);
        assertEq(vault.refundConsentNonces(id), 1);
        assertEq(token.balanceOf(address(vault)), amount);
    }
}
