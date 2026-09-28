// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/SivanMilestoneVault.sol";
import "../contracts/test/MockERC20.sol";

contract MilestoneAccountingTest is Test {
    address constant BUYER = address(0xB001);
    address constant CONTRACTOR = address(0xC001);
    address constant TREASURY = address(0xFEE);
    address constant REVIEWER = address(0xA001);
    address constant INDEPENDENT = address(0xA002);

    function testFuzz_mixedSettlementsConserveFunds(uint96 a, uint96 b, uint96 c, uint16 rate, uint96 refundSeed) public {
        uint256[3] memory amounts = [bound(a,1,1e24),bound(b,1,1e24),bound(c,1,1e24)];
        uint256 total = amounts[0]+amounts[1]+amounts[2];
        uint256 feeRate = bound(rate,0,300);
        MockERC20 token = new MockERC20("Test", "TEST", 6);
        address[] memory tokens = new address[](1); tokens[0]=address(token);
        SivanMilestoneVault vault = new SivanMilestoneVault(TREASURY,REVIEWER,feeRate,tokens);
        bytes32 id=vault.deriveProjectId(BUYER,bytes12(uint96(1)));
        SivanMilestoneVault.Input[] memory inputs = new SivanMilestoneVault.Input[](3);
        for(uint256 i; i<3; ++i) inputs[i]=SivanMilestoneVault.Input(amounts[i],7 days,keccak256(abi.encode(i)));
        vm.prank(BUYER);
        vault.proposeProject(id,CONTRACTOR,address(token),INDEPENDENT,inputs,false,1 days,1 days,block.timestamp+1 days);
        SivanMilestoneVault.Project memory p=vault.getProject(id);
        vm.prank(CONTRACTOR); vault.acceptProject(id,p.termsHash);
        token.mint(BUYER,total);
        vm.startPrank(BUYER); token.approve(address(vault),total); vault.fundProject(id,p.termsHash); vm.stopPrank();
        uint256 feeSum;
        for(uint256 i; i<3; ++i) {
            SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,i);
            assertLe(m.reservedFee,m.amount);
            feeSum+=m.reservedFee;
        }
        assertEq(feeSum,total*feeRate/10000);
        uint256 refund=bound(refundSeed,0,amounts[1]);
        // Out-of-order partial arbitration, then full release, then full refund.
        vm.prank(BUYER); vault.disputeMilestone(id,1);
        vm.prank(REVIEWER); vault.resolveMilestone(id,1,refund);
        assertEq(token.balanceOf(address(vault)),amounts[0]+amounts[2]);
        vm.prank(CONTRACTOR); vault.markDelivered(id,0,keccak256("proof"));
        vm.prank(BUYER); vault.releaseMilestone(id,0);
        vm.warp(block.timestamp+9 days+1);
        vm.prank(BUYER); vault.refundUndelivered(id,2);
        assertEq(token.balanceOf(BUYER),refund+amounts[2]);
        assertEq(token.balanceOf(BUYER)+token.balanceOf(CONTRACTOR)+token.balanceOf(TREASURY),total);
        assertEq(token.balanceOf(address(vault)),0);
        assertEq(vault.tokenLiability(address(token)),0);
        assertEq(vault.getProject(id).remaining,0);
        vm.prank(REVIEWER); vm.expectRevert(); vault.resolveMilestone(id,1,refund);
    }
}
