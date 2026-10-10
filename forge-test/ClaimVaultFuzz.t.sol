// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/SivanClaimVault.sol";
import "../contracts/test/MockERC20.sol";

contract ClaimVaultFuzzTest is Test {
    function testFuzz_claimAndRefundConserveFunds(uint96 amountA, uint96 amountB, uint32 elapsed) public {
        uint256 a = bound(amountA, 1, 1e24);
        uint256 b = bound(amountB, 1, 1e24);
        address sender = address(0xB001);
        address recipient = address(0xC001);
        address treasury = address(0xFEE);
        uint256 linkKey = 12345; // Local fixture only, never a deployed link.
        MockERC20 token = new MockERC20("Local", "LOCAL", 6);
        address[] memory tokens = new address[](1); tokens[0] = address(token);
        SivanClaimVault vault = new SivanClaimVault(address(this), treasury, tokens);
        token.mint(sender, a + b);
        vm.startPrank(sender);
        token.approve(address(vault), a + b);
        bytes32 first = vault.deposit(address(token), a, vm.addr(linkKey));
        bytes32 second = vault.deposit(address(token), b, vm.addr(linkKey));
        vm.stopPrank();
        // Read persisted expiry: the optimizer assumes block.timestamp is
        // constant within a transaction, whereas vm.warp changes it mid-test.
        (,,,, uint256 expiry,) = vault.deposits(first);
        vm.warp(expiry - 7 days + bound(elapsed, 0, 7 days - 1));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(linkKey, vault.claimDigest(first, recipient, expiry));
        vault.claim(first, recipient, expiry, abi.encodePacked(r, s, v));
        vm.warp(expiry);
        vm.prank(sender); vault.refund(second);
        assertEq(token.balanceOf(recipient), a - a / 200);
        assertEq(token.balanceOf(sender), b - b / 200);
        assertEq(token.balanceOf(treasury), a / 200 + b / 200);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.locked(address(token)), 0);
    }
}
