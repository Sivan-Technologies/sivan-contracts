// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../contracts/SivanMilestoneVault.sol";
import "../contracts/test/MockERC20.sol";

contract MilestoneSequenceHandler is Test {
    SivanMilestoneVault public vault;
    bytes32 public id;
    address public constant BUYER=address(0xB001);
    address public constant CONTRACTOR=address(0xC001);
    address public constant PRIMARY=address(0xA001);
    address public constant INDEPENDENT=address(0xA002);
    uint256 public delivered;
    uint256 public released;
    uint256 public refunded;
    uint256 public disputed;
    uint256 public overdueRequested;
    uint256 public escalated;
    uint256 public primaryResolved;
    uint256 public independentResolved;
    uint256 public skipped;
    constructor(SivanMilestoneVault v,bytes32 project) { vault=v; id=project; }
    function advance(uint32 seconds_) external { vm.warp(block.timestamp+bound(seconds_,1,10 days)); }
    function pauseFunding(bool paused) external {
        if (vault.fundingPaused()==paused) { ++skipped; return; }
        vm.prank(address(0xA110)); vault.setFundingPaused(paused);
    }
    function deliver(uint8 index) external {
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,index%3);
        if(m.state!=SivanMilestoneVault.State.Funded || block.timestamp>vault.getProject(id).fundedAt+m.duration) { ++skipped; return; }
        vm.prank(CONTRACTOR); vault.markDelivered(id,index%3,keccak256("proof"));
        ++delivered;
    }
    function release(uint8 index) external {
        if(vault.getMilestone(id,index%3).state!=SivanMilestoneVault.State.Delivered) { ++skipped; return; }
        vm.prank(BUYER); vault.releaseMilestone(id,index%3); ++released;
    }
    function refund(uint8 index) external {
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,index%3);
        if(m.state!=SivanMilestoneVault.State.Funded || block.timestamp<=vault.getProject(id).fundedAt+m.duration+vault.DISPUTE_GRACE()) { ++skipped; return; }
        vm.prank(BUYER); vault.refundUndelivered(id,index%3); ++refunded;
    }
    function dispute(uint8 index,bool buyer) external {
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,index%3);
        if(m.state!=SivanMilestoneVault.State.Funded && m.state!=SivanMilestoneVault.State.Delivered) { ++skipped; return; }
        if(m.state==SivanMilestoneVault.State.Funded && block.timestamp>vault.getProject(id).fundedAt+m.duration+vault.DISPUTE_GRACE()) { ++skipped; return; }
        vm.prank(buyer?BUYER:CONTRACTOR); vault.disputeMilestone(id,index%3);
        ++disputed;
    }
    function overdue(uint8 index) external {
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,index%3);
        if(m.state!=SivanMilestoneVault.State.Delivered || block.timestamp<=m.deliveredAt+vault.getProject(id).reviewWindow) { ++skipped; return; }
        vm.prank(index % 2 == 0 ? BUYER : CONTRACTOR);
        vault.requestOverdueReview(id,index%3);
        ++overdueRequested;
    }
    function escalate(uint8 index) external {
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,index%3);
        if(m.state!=SivanMilestoneVault.State.Disputed || m.escalated || block.timestamp<=m.reviewDeadline) { ++skipped; return; }
        vault.escalateMilestone(id,index%3); ++escalated;
    }
    function resolve(uint8 index,uint96 refund_,bool independent) external {
        uint256 i=index%3;
        SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,i);
        if(m.state!=SivanMilestoneVault.State.Disputed || independent!=m.escalated || (!independent && block.timestamp>m.reviewDeadline)) { ++skipped; return; }
        uint256 refundAmount=bound(refund_,0,vault.getMilestone(id,i).amount);
        vm.prank(independent?INDEPENDENT:PRIMARY); vault.resolveMilestone(id,i,refundAmount);
        if(independent) ++independentResolved; else ++primaryResolved;
    }
}

contract MilestoneInvariantTest is StdInvariant,Test {
    SivanMilestoneVault vault;
    MockERC20 token;
    MilestoneSequenceHandler handler;
    bytes32 id;
    address constant BUYER=address(0xB001);
    address constant CONTRACTOR=address(0xC001);
    address constant TREASURY=address(0xFEE);
    uint256 constant TOTAL=500e6;
    function setUp() public {
        token=new MockERC20("Test USDC","USDC",6);
        address[] memory tokens=new address[](1); tokens[0]=address(token);
        vault=new SivanMilestoneVault(TREASURY,address(0xA001),100,tokens,address(0xA110));
        id=vault.deriveProjectId(BUYER,bytes12(uint96(1)));
        SivanMilestoneVault.Input[] memory inputs=new SivanMilestoneVault.Input[](3);
        inputs[0]=SivanMilestoneVault.Input(100e6,7 days,keccak256("design"));
        inputs[1]=SivanMilestoneVault.Input(250e6,7 days,keccak256("backend"));
        inputs[2]=SivanMilestoneVault.Input(150e6,7 days,keccak256("frontend"));
        vm.prank(BUYER); vault.proposeProject(id,CONTRACTOR,address(token),address(0xA002),inputs,false,1 days,1 days,block.timestamp+1 days,1 days);
        bytes32 hash=vault.getProject(id).termsHash;
        vm.prank(CONTRACTOR); vault.acceptProject(id,hash);
        token.mint(BUYER,TOTAL);
        vm.startPrank(BUYER); token.approve(address(vault),TOTAL); vault.fundProject(id,hash); vm.stopPrank();
        handler=new MilestoneSequenceHandler(vault,id);
        targetContract(address(handler));
        bytes4[] memory selectors=new bytes4[](9);
        selectors[0]=handler.advance.selector; selectors[1]=handler.deliver.selector;
        selectors[2]=handler.release.selector; selectors[3]=handler.refund.selector;
        selectors[4]=handler.dispute.selector; selectors[5]=handler.overdue.selector;
        selectors[6]=handler.escalate.selector; selectors[7]=handler.resolve.selector;
        selectors[8]=handler.pauseFunding.selector;
        targetSelector(FuzzSelector(address(handler),selectors));
    }
    function invariant_allFundsConservedAndLiabilitiesBacked() public view {
        uint256 remaining;
        for(uint256 i;i<3;++i) {
            SivanMilestoneVault.Milestone memory m=vault.getMilestone(id,i);
            bool terminal=m.state==SivanMilestoneVault.State.Released || m.state==SivanMilestoneVault.State.Refunded;
            if(!terminal) remaining+=m.amount;
            assertEq(m.nonce,terminal?1:0);
        }
        uint256 balance=token.balanceOf(address(vault));
        assertEq(balance,remaining);
        assertEq(vault.tokenLiability(address(token)),remaining);
        assertEq(vault.getProject(id).remaining,remaining);
        assertEq(balance+token.balanceOf(BUYER)+token.balanceOf(CONTRACTOR)+token.balanceOf(TREASURY),TOTAL);
        assertLe(token.balanceOf(TREASURY),5e6);
        uint256 settled;
        for(uint256 i;i<3;++i) if(vault.getMilestone(id,i).nonce==1) ++settled;
        assertEq(settled,handler.released()+handler.refunded()+handler.primaryResolved()+handler.independentResolved());
    }

    function test_successfulDeliveryReleaseAndPrimaryRuling() public {
        handler.deliver(0); handler.release(0);
        handler.dispute(1,true); handler.resolve(1,100e6,false);
        assertEq(handler.delivered(),1); assertEq(handler.released(),1);
        assertEq(handler.disputed(),1); assertEq(handler.primaryResolved(),1);
        invariant_allFundsConservedAndLiabilitiesBacked();
    }
    function test_successfulOverdueEscalationIndependentRulingAndRefund() public {
        handler.deliver(0);
        handler.advance(uint32(1 days+1)); handler.overdue(0);
        handler.advance(uint32(1 days+1)); handler.escalate(0);
        handler.resolve(0,50e6,true);
        handler.advance(uint32(10 days)); handler.refund(1); handler.refund(2);
        assertEq(handler.overdueRequested(),1); assertEq(handler.escalated(),1);
        assertEq(handler.independentResolved(),1); assertEq(handler.refunded(),2);
        invariant_allFundsConservedAndLiabilitiesBacked();
    }
    function testFuzz_successfulSettlementRoutes(uint8 route,uint96 refund_) public {
        uint256 choice=route%5;
        if(choice==0) { handler.deliver(0); handler.release(0); assertEq(handler.released(),1); }
        else if(choice==1) { handler.advance(uint32(10 days)); handler.refund(0); assertEq(handler.refunded(),1); }
        else {
            if(choice==4) { handler.deliver(0); handler.advance(uint32(1 days+1)); handler.overdue(0); }
            else handler.dispute(0,true);
            if(choice>=3) { handler.advance(uint32(1 days+1)); handler.escalate(0); }
            handler.resolve(0,refund_,choice>=3);
            assertEq(handler.primaryResolved()+handler.independentResolved(),1);
        }
        assertEq(vault.getMilestone(id,0).nonce,1);
        invariant_allFundsConservedAndLiabilitiesBacked();
    }
}
