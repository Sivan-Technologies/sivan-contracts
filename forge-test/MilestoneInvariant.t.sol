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
    constructor(SivanMilestoneVault v,bytes32 project) { vault=v; id=project; }
    function advance(uint32 seconds_) external { vm.warp(block.timestamp+bound(seconds_,1,10 days)); }
    function deliver(uint8 index) external {
        vm.prank(CONTRACTOR); vault.markDelivered(id,index%3,keccak256("proof"));
    }
    function release(uint8 index) external { vm.prank(BUYER); vault.releaseMilestone(id,index%3); }
    function refund(uint8 index) external { vm.prank(BUYER); vault.refundUndelivered(id,index%3); }
    function dispute(uint8 index,bool buyer) external {
        vm.prank(buyer?BUYER:CONTRACTOR); vault.disputeMilestone(id,index%3);
    }
    function overdue(uint8 index) external { vault.requestOverdueReview(id,index%3); }
    function escalate(uint8 index) external { vault.escalateMilestone(id,index%3); }
    function resolve(uint8 index,uint96 refund_,bool independent) external {
        uint256 i=index%3;
        uint256 refundAmount=bound(refund_,0,vault.getMilestone(id,i).amount);
        vm.prank(independent?INDEPENDENT:PRIMARY); vault.resolveMilestone(id,i,refundAmount);
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
        vault=new SivanMilestoneVault(TREASURY,address(0xA001),100,tokens);
        id=vault.deriveProjectId(BUYER,bytes12(uint96(1)));
        SivanMilestoneVault.Input[] memory inputs=new SivanMilestoneVault.Input[](3);
        inputs[0]=SivanMilestoneVault.Input(100e6,7 days,keccak256("design"));
        inputs[1]=SivanMilestoneVault.Input(250e6,7 days,keccak256("backend"));
        inputs[2]=SivanMilestoneVault.Input(150e6,7 days,keccak256("frontend"));
        vm.prank(BUYER); vault.proposeProject(id,CONTRACTOR,address(token),address(0xA002),inputs,false,1 days,1 days,block.timestamp+1 days);
        bytes32 hash=vault.getProject(id).termsHash;
        vm.prank(CONTRACTOR); vault.acceptProject(id,hash);
        token.mint(BUYER,TOTAL);
        vm.startPrank(BUYER); token.approve(address(vault),TOTAL); vault.fundProject(id,hash); vm.stopPrank();
        handler=new MilestoneSequenceHandler(vault,id);
        targetContract(address(handler));
        bytes4[] memory selectors=new bytes4[](8);
        selectors[0]=handler.advance.selector; selectors[1]=handler.deliver.selector;
        selectors[2]=handler.release.selector; selectors[3]=handler.refund.selector;
        selectors[4]=handler.dispute.selector; selectors[5]=handler.overdue.selector;
        selectors[6]=handler.escalate.selector; selectors[7]=handler.resolve.selector;
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
    }
}
