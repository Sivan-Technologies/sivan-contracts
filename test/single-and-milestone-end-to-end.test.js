const {expect}=require("chai");
const {ethers}=require("hardhat");
const {time,loadFixture}=require("@nomicfoundation/hardhat-network-helpers");
const {fund}=require("./helpers/fund");

describe("Single and milestone agreements together (local E2E)",()=>{
  const U=n=>BigInt(n)*1000000n, DAY=86400;
  async function fixture() {
    const [owner,buyer,contractor,treasury,agent,partner,,,,independent]=await ethers.getSigners();
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("Test USDC","USDC",6);
    const single=await (await ethers.getContractFactory("SivanAgreementVault")).deploy(treasury.address,agent.address,9827,owner.address);
    await single.setSupportedToken(await token.getAddress(),true);
    const multi=await (await ethers.getContractFactory("SivanMilestoneVault")).deploy(treasury.address,owner.address,100,[await token.getAddress()],"0x000000000000000000000000000000000000a110");
    // Deliberately reuse the buyer's ID in distinct vaults to test address/domain isolation.
    const id=ethers.concat([buyer.address,"0x000000000000000000000123"]);
    await token.transfer(buyer.address,U(600));
    await token.connect(buyer).approve(await single.getAddress(),U(100));
    await fund(single.connect(buyer),id,contractor.address,await token.getAddress(),U(100),24,partner.address);
    const inputs=[100,250,150].map((n,i)=>({amount:U(n),duration:7*DAY,scopeHash:ethers.id(`scope-${i}`)}));
    await multi.connect(buyer).proposeProject(id,contractor.address,await token.getAddress(),independent.address,
      inputs,false,DAY,DAY,(await time.latest())+DAY,DAY);
    const p=await multi.getProject(id);
    await multi.connect(contractor).acceptProject(id,p.termsHash);
    const c={owner,buyer,contractor,treasury,agent,partner,independent,token,single,multi,id};
    c.fundMulti=async()=>{
      await token.connect(buyer).approve(await multi.getAddress(),U(500));
      await multi.connect(buyer).fundProject(id,p.termsHash);
    };
    c.deliverMulti=async i=>multi.connect(contractor).markDelivered(id,i,ethers.id(`proof-${i}`));
    c.releaseMulti=async i=>multi.connect(buyer).releaseMilestone(id,i);
    c.deliverSingle=async()=>{
      await single.connect(contractor).markDelivered(id,"single-job-proof");
      const a=await single.getAgreement(id);
      return agent.signTypedData({name:"Sivan Celo Settlement Facility",version:"1",chainId:31337,verifyingContract:await single.getAddress()},
        {AgentAttestation:[{name:"agreementId",type:"bytes32"},{name:"agentId",type:"uint256"},{name:"deliverableHash",type:"bytes32"},{name:"timestamp",type:"uint256"}]},
        {agreementId:id,agentId:9827,deliverableHash:ethers.id("single-job-proof"),timestamp:a.deadlineTimestamp});
    };
    return c;
  }
  async function funded() {const c=await fixture();await c.fundMulti();return c;}
  async function signatures(c,kind,refund) {
    const expiry=(await time.latest())+3600;
    const multi=kind==="multi", vault=multi?c.multi:c.single;
    const domain={name:multi?"SivanMilestoneVault":"Sivan Celo Settlement Facility",version:"1",chainId:31337,verifyingContract:await vault.getAddress()};
    const types=multi?{MilestoneSettlement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},
      {name:"termsHash",type:"bytes32"},{name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]}:
      {DisputeSettlement:[{name:"agreementId",type:"bytes32"},{name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
    const value=multi?{projectId:c.id,index:0,termsHash:(await c.multi.getProject(c.id)).termsHash,buyerRefund:refund,
      nonce:(await c.multi.getMilestone(c.id,0)).nonce,expiry}:
      {agreementId:c.id,buyerRefund:refund,nonce:await c.single.agreementNonces(c.id),expiry};
    return [expiry,await c.buyer.signTypedData(domain,types,value),await c.contractor.signTypedData(domain,types,value)];
  }
  it("interleaves both releases and reconciles all $600 and both fee policies",async()=>{
    const c=await loadFixture(funded), a=await c.single.getAgreement(c.id);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(U(100));
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(U(500));
    await c.deliverMulti(2); await c.releaseMulti(2);
    expect((await c.single.getAgreement(c.id)).state).eq(1);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(U(100));
    const proof=await c.deliverSingle();
    await expect(c.single.connect(c.buyer).releasePayment(c.id,"0x","0x",0)).reverted;
    await c.single.connect(c.buyer).releasePayment(c.id,"0x",proof,0);
    expect((await c.multi.getProject(c.id)).remaining).eq(U(350));
    for(const i of [0,1]) {await c.deliverMulti(i);await c.releaseMulti(i);}
    expect(await c.token.balanceOf(c.contractor.address)).eq(a.netAmount+U(495));
    expect(await c.token.balanceOf(c.treasury.address)).eq(a.feeAmount-a.partnerFeeAmount+U(5));
    expect(await c.token.balanceOf(c.partner.address)).eq(a.partnerFeeAmount);
    expect(await c.token.balanceOf(c.buyer.address)).eq(0);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(0);
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(0);
    expect(await c.multi.tokenLiability(await c.token.getAddress())).eq(0);
    await expect(c.single.connect(c.buyer).releasePayment(c.id,"0x",proof,0)).reverted;
    await expect(c.releaseMulti(0)).reverted;
  });
  it("refunds a single job while milestone arbitration remains isolated, then closes both",async()=>{
    const c=await loadFixture(funded), a=await c.single.getAgreement(c.id);
    await c.deliverMulti(0); await c.multi.connect(c.buyer).disputeMilestone(c.id,0);
    await time.increaseTo(Number(a.refundUnlockAt)+1);
    await c.single.connect(c.buyer).refundBuyer(c.id);
    expect(await c.token.balanceOf(c.buyer.address)).eq(U(100));
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(U(500));
    expect((await c.multi.getMilestone(c.id,0)).state).eq(3);
    const m=await c.multi.getMilestone(c.id,0);
    if((await time.latest())<=Number(m.reviewDeadline)) await time.increaseTo(Number(m.reviewDeadline)+1);
    await c.multi.escalateMilestone(c.id,0);
    await expect(c.multi.connect(c.buyer).refundUndelivered(c.id,0)).reverted;
    await c.multi.connect(c.independent).resolveMilestone(c.id,0,U(40));
    const p=await c.multi.getProject(c.id);
    await time.increaseTo(Number(p.fundedAt)+9*DAY+1);
    for(const i of [1,2]) await c.multi.connect(c.buyer).refundUndelivered(c.id,i);
    expect(await c.token.balanceOf(c.buyer.address)).eq(U(540));
    expect(await c.token.balanceOf(c.contractor.address)).eq(59400000);
    expect(await c.token.balanceOf(c.treasury.address)).eq(600000);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(0);
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(0);
  });
  it("never lets an approval or failed funding in one vault use the other's escrow",async()=>{
    const c=await loadFixture(fixture), p=await c.multi.getProject(c.id);
    // Even an unused large allowance to SINGLE gives MULTI no spending authority.
    await c.token.connect(c.buyer).approve(await c.single.getAddress(),U(500));
    await expect(c.multi.connect(c.buyer).fundProject(c.id,p.termsHash)).reverted;
    expect((await c.multi.getProject(c.id)).fundedAt).eq(0);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(U(100));
    expect((await c.single.getAgreement(c.id)).state).eq(1);
    await c.fundMulti();
    await expect(c.multi.connect(c.buyer).fundProject(c.id,p.termsHash)).revertedWith("Already funded");
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(U(100));
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(U(500));
  });
  it("rejects settlement signatures from the other vault despite matching users, ID and refund",async()=>{
    const c=await loadFixture(funded), refund=U(40);
    await c.single.connect(c.buyer).raiseDispute(c.id,"single evidence");
    const s=await signatures(c,"single",refund), m=await signatures(c,"multi",refund);
    await expect(c.multi.settleByAgreement(c.id,0,refund,...s)).revertedWith("Buyer consent required");
    await expect(c.single.settleDisputeByAgreement(c.id,refund,...m)).revertedWith("Buyer settlement consent required");
    expect((await c.multi.getMilestone(c.id,0)).nonce).eq(0);
    // Correct signatures remain usable after both failed cross-vault attempts.
    await c.multi.settleByAgreement(c.id,0,refund,...m);
    expect((await c.single.getAgreement(c.id)).state).eq(5);
    await c.single.settleDisputeByAgreement(c.id,refund,...s);
    expect((await c.multi.getProject(c.id)).remaining).eq(U(400));
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(0);
    expect(await c.token.balanceOf(await c.multi.getAddress())).eq(U(400));
  });
  it("single-vault pausing and later fee changes do not mutate the milestone project",async()=>{
    const c=await loadFixture(funded), before=await c.multi.getProject(c.id);
    await c.single.pause(); await c.single.setFeeCollector(c.partner.address);
    await c.deliverMulti(0); await c.releaseMulti(0);
    expect(await c.token.balanceOf(c.treasury.address)).eq(U(1));
    expect(await c.token.balanceOf(c.partner.address)).eq(0);
    expect((await c.multi.getProject(c.id)).termsHash).eq(before.termsHash);
    expect(await c.token.balanceOf(await c.single.getAddress())).eq(U(100));
    await c.single.unpause();
    await c.single.connect(c.buyer).releasePayment(c.id,"0x","0x",0);
    expect((await c.single.getAgreement(c.id)).state).eq(3);
    expect((await c.multi.getProject(c.id)).remaining).eq(U(400));
  });
});
