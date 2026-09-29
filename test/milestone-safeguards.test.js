const {expect}=require("chai");
const {ethers}=require("hardhat");
const {loadFixture,time}=require("@nomicfoundation/hardhat-network-helpers");
const DAY=86400;
describe("Milestone funding pause and bilateral reviewer recovery",()=>{
  async function fixture() {
    const [buyer,contractor,treasury,primary,independent,replacement,adminSigner,outsider]=await ethers.getSigners();
    // Contract-call fixture only, not a production Safe or a threshold-policy test.
    const admin=await (await ethers.getContractFactory("MilestoneTestWallet")).deploy(adminSigner.address);
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
    const vault=await (await ethers.getContractFactory("SivanMilestoneVault")).deploy(treasury.address,primary.address,100,[await token.getAddress()],await admin.getAddress());
    const id=ethers.concat([buyer.address,ethers.randomBytes(12)]);
    const inputs=Array.from({length:5},(_,i)=>({amount:100000000,duration:7*DAY,scopeHash:ethers.id(`scope ${i}`)}));
    const propose=async(project=id,recovery=DAY)=>vault.proposeProject(project,contractor.address,await token.getAddress(),independent.address,
      inputs,false,DAY,DAY,(await time.latest())+DAY,recovery);
    const accept=async(project=id)=>vault.connect(contractor).acceptProject(project,(await vault.getProject(project)).termsHash);
    const fund=async(project=id)=>{await token.approve(await vault.getAddress(),500000000);return vault.fundProject(project,(await vault.getProject(project)).termsHash);};
    const pause=async value=>admin.connect(adminSigner).execute(await vault.getAddress(),vault.interface.encodeFunctionData("setFundingPaused",[value]));
    await propose();await accept();await fund();
    return {buyer,contractor,treasury,primary,independent,replacement,adminSigner,outsider,admin,token,vault,id,propose,accept,fund,pause};
  }
  async function escalated() {
    const c=await fixture();
    await c.vault.disputeMilestone(c.id,0);await c.vault.disputeMilestone(c.id,1);
    await time.increase(DAY+1);await c.vault.escalateMilestone(c.id,0);await c.vault.escalateMilestone(c.id,1);
    return c;
  }
  const types={ReviewerReplacement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},{name:"termsHash",type:"bytes32"},
    {name:"currentReviewer",type:"address"},{name:"replacement",type:"address"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
  async function consent(c,index=0,replacement=c.replacement.address,overrides={},domainOverrides={}) {
    const m=await c.vault.getMilestone(c.id,index),p=await c.vault.getProject(c.id),expiry=(await time.latest())+3600;
    const value={projectId:c.id,index,termsHash:p.termsHash,currentReviewer:m.activeReviewer,replacement,nonce:m.replacementNonce,expiry,...overrides};
    const domain={name:"SivanMilestoneVault",version:"1",chainId:31337,verifyingContract:await c.vault.getAddress(),...domainOverrides};
    return [value.expiry,await c.buyer.signTypedData(domain,types,value),await c.contractor.signTypedData(domain,types,value)];
  }
  it("only the configured admin contract can pause/unpause and each change emits an event",async()=>{
    const c=await loadFixture(fixture);
    await expect(c.vault.setFundingPaused(true)).revertedWith("Only funding admin");
    await expect(c.vault.connect(c.adminSigner).setFundingPaused(true)).revertedWith("Only funding admin");
    await expect(c.pause(true)).emit(c.vault,"FundingPauseChanged").withArgs(await c.admin.getAddress(),true);
    await expect(c.pause(true)).revertedWith("Pause unchanged");
    await expect(c.pause(false)).emit(c.vault,"FundingPauseChanged").withArgs(await c.admin.getAddress(),false);
  });
  it("blocks only new funding with no balance movement; proposals, acceptance and retry remain available",async()=>{
    const c=await loadFixture(fixture),id=ethers.concat([c.buyer.address,ethers.randomBytes(12)]);
    await c.pause(true);await c.propose(id);await c.accept(id);
    const before=await c.token.balanceOf(await c.vault.getAddress());
    await expect(c.fund(id)).revertedWith("Funding paused");
    expect((await c.vault.getProject(id)).fundedAt).eq(0);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(before);
    await c.pause(false);await c.fund(id);expect((await c.vault.getProject(id)).remaining).eq(500000000);
  });
  it("keeps delivery, release, primary/independent disputes, refunds and mutual settlement working while paused",async()=>{
    const c=await loadFixture(fixture);await c.pause(true);
    await c.vault.connect(c.contractor).markDelivered(c.id,0,ethers.id("proof"));await c.vault.releaseMilestone(c.id,0);
    await c.vault.disputeMilestone(c.id,1);await c.vault.connect(c.primary).resolveMilestone(c.id,1,100000000);
    await c.vault.disputeMilestone(c.id,2);await time.increase(DAY+1);await c.vault.escalateMilestone(c.id,2);
    await c.vault.connect(c.independent).resolveMilestone(c.id,2,40000000);
    const expiry=(await time.latest())+3600,p=await c.vault.getProject(c.id);
    const st={MilestoneSettlement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},{name:"termsHash",type:"bytes32"},
      {name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
    const d={name:"SivanMilestoneVault",version:"1",chainId:31337,verifyingContract:await c.vault.getAddress()};
    const v={projectId:c.id,index:3,termsHash:p.termsHash,buyerRefund:50000000,nonce:0,expiry};
    await c.vault.settleByAgreement(c.id,3,50000000,expiry,await c.buyer.signTypedData(d,st,v),await c.contractor.signTypedData(d,st,v));
    await time.increaseTo(Number(p.fundedAt)+9*DAY+1);await c.vault.refundUndelivered(c.id,4);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(0);
    expect(await c.vault.fundingPaused()).eq(true);
  });
  it("binds the recovery wait into accepted immutable terms and rejects unbounded waits",async()=>{
    const c=await loadFixture(fixture);
    expect((await c.vault.getProject(c.id)).recoveryPeriod).eq(DAY);
    for(const period of [0,DAY-1,30*DAY+1]) {
      const id=ethers.concat([c.buyer.address,ethers.randomBytes(12)]);
      await expect(c.propose(id,period)).revertedWith("Invalid recovery period");
    }
  });
  it("allows overdue review while paused but gives the funding admin no ruling power",async()=>{
    const c=await loadFixture(fixture);
    await c.vault.connect(c.contractor).markDelivered(c.id,4,ethers.id("proof"));
    await c.pause(true);await time.increase(DAY+1);await c.vault.requestOverdueReview(c.id,4);
    const data=c.vault.interface.encodeFunctionData("resolveMilestone",[c.id,4,0]);
    await expect(c.admin.connect(c.adminSigner).execute(await c.vault.getAddress(),data)).revertedWith("Primary review closed");
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(500000000);
    await c.vault.connect(c.primary).resolveMilestone(c.id,4,100000000);
  });
  it("requires escalation and the full agreed recovery wait",async()=>{
    const c=await loadFixture(fixture);
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,...await consent(c))).revertedWith("Not escalated dispute");
    const e=await loadFixture(escalated);
    await expect(e.vault.replaceIndependentReviewer(e.id,0,e.replacement.address,...await consent(e))).revertedWith("Recovery not due");
  });
  it("replaces only this milestone's reviewer while paused without moving funds or changing settlement state",async()=>{
    const c=await loadFixture(escalated);await time.increase(DAY);await c.pause(true);
    const before=await c.vault.getProject(c.id),balance=await c.token.balanceOf(await c.vault.getAddress());
    await expect(c.vault.connect(c.outsider).replaceIndependentReviewer(c.id,0,c.replacement.address,...await consent(c)))
      .emit(c.vault,"ReviewerReplaced").withArgs(c.id,0,c.independent.address,c.replacement.address,1);
    const m=await c.vault.getMilestone(c.id,0);
    expect(m.state).eq(3);expect(m.nonce).eq(0);expect(m.replacementNonce).eq(1);
    expect((await c.vault.getMilestone(c.id,1)).activeReviewer).eq(c.independent.address);
    expect((await c.vault.getProject(c.id)).termsHash).eq(before.termsHash);
    expect((await c.vault.getProject(c.id)).remaining).eq(before.remaining);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(balance);
    await expect(c.vault.connect(c.independent).resolveMilestone(c.id,0,0)).revertedWith("Only independent reviewer");
    await c.vault.connect(c.replacement).resolveMilestone(c.id,0,40000000);
    await c.vault.connect(c.independent).resolveMilestone(c.id,1,100000000);
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.outsider.address,...await consent(c,0,c.outsider.address))).revertedWith("Not escalated dispute");
  });
  it("rejects unilateral and admin replacement, invalid recipients and missing party consent",async()=>{
    const c=await loadFixture(escalated);await time.increase(DAY);
    const sig=await consent(c);
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,sig[0],sig[1],"0x")).revertedWith("Contractor consent required");
    const data=c.vault.interface.encodeFunctionData("replaceIndependentReviewer",[c.id,0,c.replacement.address,sig[0],"0x","0x"]);
    await expect(c.admin.connect(c.adminSigner).execute(await c.vault.getAddress(),data)).revertedWith("Buyer consent required");
    for(const a of [ethers.ZeroAddress,await c.vault.getAddress(),await c.admin.getAddress(),c.buyer.address,c.contractor.address,c.treasury.address,c.primary.address,c.independent.address])
      await expect(c.vault.replaceIndependentReviewer(c.id,0,a,...sig)).revertedWith("Replacement reviewer conflict");
  });
  it("rejects cross-chain/vault/milestone signatures, altered reviewer, stale nonce and expired consent",async()=>{
    const c=await loadFixture(escalated);await time.increase(DAY);
    for(const [value,domain] of [[{index:1},{}],[{projectId:ethers.ZeroHash},{}],[{currentReviewer:c.primary.address},{}],[{nonce:1},{}],[{}, {chainId:1}],[{}, {verifyingContract:c.token.target}]]) {
      await expect(c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,...await consent(c,0,c.replacement.address,value,domain))).revertedWith("Buyer consent required");
    }
    const expired=await consent(c,0,c.replacement.address,{expiry:(await time.latest())-1});
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,...expired)).revertedWith("Invalid expiry");
    const tooLong=await consent(c,0,c.replacement.address,{expiry:(await time.latest())+2*DAY});
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,...tooLong)).revertedWith("Invalid expiry");
    const sig=await consent(c);await c.vault.replaceIndependentReviewer(c.id,0,c.replacement.address,...sig);
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.outsider.address,...sig)).revertedWith("Recovery not due");
    await time.increase(DAY);
    // Fresh expiry with old reviewer/nonce still cannot authorize a subsequent change.
    const stale=await consent(c,0,c.outsider.address,{currentReviewer:c.independent.address,nonce:0});
    await expect(c.vault.replaceIndependentReviewer(c.id,0,c.outsider.address,...stale)).revertedWith("Buyer consent required");
    await c.vault.replaceIndependentReviewer(c.id,0,c.outsider.address,...await consent(c,0,c.outsider.address));
    expect((await c.vault.getMilestone(c.id,0)).replacementNonce).eq(2);
  });
});
