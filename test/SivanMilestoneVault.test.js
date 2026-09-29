const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("SivanMilestoneVault (isolated local milestone escrow)", function () {
  const day = 86400;
  const u = n => BigInt(n) * 1000000n;
  async function fixture() {
    const [buyer, contractor, treasury, primary, independent, stranger] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const Factory = await ethers.getContractFactory("SivanMilestoneVault");
    const vault = await Factory.deploy(treasury.address, primary.address, 100, [await token.getAddress()], "0x000000000000000000000000000000000000a110");
    const id = ethers.concat([buyer.address, "0x000000000000000000000001"]);
    const inputs = [100,250,150].map(amount => ({amount:u(amount),duration:7*day,scopeHash:ethers.id(String(amount))}));
    const c = {buyer,contractor,treasury,primary,independent,stranger,token,vault,Factory,id,inputs};
    c.propose = async (sequential=false, items=inputs, projectId=id, reviewer=independent.address) =>
      vault.proposeProject(projectId,contractor.address,await token.getAddress(),reviewer,items,sequential,day,day,(await time.latest())+day,day);
    c.accept = async (projectId=id) => vault.connect(contractor).acceptProject(projectId,(await vault.projects(projectId)).termsHash);
    c.fund = async (projectId=id) => {
      const p = await vault.projects(projectId);
      await token.approve(await vault.getAddress(),p.total);
      return vault.fundProject(projectId,p.termsHash);
    };
    c.deliver = async index => vault.connect(contractor).markDelivered(id,index,ethers.id(`proof${index}`));
    return c;
  }
  async function funded() {
    const c = await fixture(); await c.propose(); await c.accept(); await c.fund(); return c;
  }
  async function signatures(c,index,refund, overrides={}) {
    const p=await c.vault.projects(c.id), m=await c.vault.milestones(c.id,index);
    const expiry=(await time.latest())+3600;
    const domain={name:"SivanMilestoneVault",version:"1",chainId:31337,verifyingContract:await c.vault.getAddress()};
    const types={MilestoneSettlement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},
      {name:"termsHash",type:"bytes32"},{name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
    const value={projectId:c.id,index,termsHash:p.termsHash,buyerRefund:refund,nonce:m.nonce,expiry,...overrides};
    return [expiry,await c.buyer.signTypedData(domain,types,value),await c.contractor.signTypedData(domain,types,value)];
  }
  it("funds $500 once with exact allocations, reserving but not collecting $5", async () => {
    const c=await loadFixture(funded), p=await c.vault.projects(c.id);
    expect(p.total).eq(u(500)); expect(p.remaining).eq(u(500)); expect(p.reservedFee).eq(u(5));
    expect(await c.token.balanceOf(c.treasury.address)).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(u(500));
    expect((await c.vault.milestones(c.id,1)).reservedFee).eq(2500000);
    await expect(c.fund()).revertedWith("Already funded");
  });
  it("requires real contractor consent and the exact agreed terms", async () => {
    const c=await loadFixture(fixture); await c.propose();
    await expect(c.fund()).revertedWith("Terms not accepted or expired");
    await expect(c.vault.acceptProject(c.id,(await c.vault.projects(c.id)).termsHash)).revertedWith("Only contractor");
    await expect(c.vault.connect(c.contractor).acceptProject(c.id,ethers.ZeroHash)).revertedWith("Terms mismatch");
    await c.accept(); await expect(c.vault.fundProject(c.id,ethers.ZeroHash)).revertedWith("Terms mismatch");
  });
  it("prevents project ID squatting and proposal mutation", async () => {
    const c=await loadFixture(fixture);
    await expect(c.vault.connect(c.stranger).proposeProject(c.id,c.contractor.address,await c.token.getAddress(),
      c.independent.address,c.inputs,false,day,day,(await time.latest())+day,day)).revertedWith("Project ID must belong to buyer");
    await c.propose(); await expect(c.propose()).revertedWith("Project already exists");
  });
  it("rolls back every milestone and liability when the single transfer fails", async () => {
    const c=await loadFixture(fixture); await c.propose(); await c.accept();
    await expect(c.vault.fundProject(c.id,(await c.vault.projects(c.id)).termsHash)).reverted;
    expect((await c.vault.projects(c.id)).fundedAt).eq(0);
    expect((await c.vault.milestones(c.id,2)).state).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(0);
  });
  it("releases independently out of order only on buyer acceptance", async () => {
    const c=await loadFixture(funded); await c.deliver(2);
    expect(await c.token.balanceOf(c.contractor.address)).eq(0);
    await expect(c.vault.connect(c.contractor).releaseMilestone(c.id,2)).revertedWith("Only buyer");
    await c.vault.releaseMilestone(c.id,2);
    expect(await c.token.balanceOf(c.contractor.address)).eq(148500000);
    expect(await c.token.balanceOf(c.treasury.address)).eq(1500000);
    expect((await c.vault.projects(c.id)).remaining).eq(u(350));
    await expect(c.vault.releaseMilestone(c.id,2)).revertedWith("Delivery required");
    await expect(c.vault.releaseMilestone(c.id,0)).revertedWith("Delivery required");
  });
  it("enforces optional ordering for ordinary releases", async () => {
    const c=await loadFixture(fixture); await c.propose(true); await c.accept(); await c.fund();
    await c.deliver(1); await expect(c.vault.releaseMilestone(c.id,1)).revertedWith("Earlier milestone unsettled");
    await c.deliver(0); await c.vault.releaseMilestone(c.id,0); await c.vault.releaseMilestone(c.id,1);
  });
  it("refunds full undelivered gross allocation including the reserved fee", async () => {
    const c=await loadFixture(funded);
    await expect(c.vault.refundUndelivered(c.id,0)).revertedWith("Refund not due");
    await time.increase(9*day+1);
    const before=await c.token.balanceOf(c.buyer.address); await c.vault.refundUndelivered(c.id,0);
    expect((await c.token.balanceOf(c.buyer.address))-before).eq(u(100));
    expect(await c.token.balanceOf(c.treasury.address)).eq(0);
    await expect(c.vault.disputeMilestone(c.id,1)).revertedWith("Dispute window closed");
  });
  it("never lets a buyer refund delivered or disputed work after a timeout", async () => {
    const c=await loadFixture(funded); await c.deliver(0); await time.increase(10*day);
    await expect(c.vault.refundUndelivered(c.id,0)).revertedWith("Not undelivered");
    await c.vault.connect(c.contractor).requestOverdueReview(c.id,0);
    await time.increase(day+1); await c.vault.escalateMilestone(c.id,0); await time.increase(365*day);
    await expect(c.vault.refundUndelivered(c.id,0)).revertedWith("Not undelivered");
    expect((await c.vault.milestones(c.id,0)).state).eq(3);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(u(500));
  });
  it("isolates a dispute and enforces the primary/independent authority boundary", async () => {
    const c=await loadFixture(funded); await c.vault.disputeMilestone(c.id,0);
    await expect(c.vault.connect(c.independent).resolveMilestone(c.id,0,0)).revertedWith("Primary review closed");
    await expect(c.vault.escalateMilestone(c.id,0)).revertedWith("Escalation not due");
    await c.deliver(2); await c.vault.releaseMilestone(c.id,2);
    await time.increase(day+1);
    await expect(c.vault.connect(c.primary).resolveMilestone(c.id,0,0)).revertedWith("Primary review closed");
    await c.vault.escalateMilestone(c.id,0);
    await expect(c.vault.connect(c.primary).resolveMilestone(c.id,0,0)).revertedWith("Only independent reviewer");
    await c.vault.connect(c.independent).resolveMilestone(c.id,0,u(100));
    expect((await c.vault.projects(c.id)).remaining).eq(u(250));
  });
  it("charges a proportional fee only on the gross portion paid for work", async () => {
    const c=await loadFixture(funded); await c.vault.disputeMilestone(c.id,0);
    const before=await c.token.balanceOf(c.buyer.address);
    await c.vault.connect(c.primary).resolveMilestone(c.id,0,u(40));
    expect((await c.token.balanceOf(c.buyer.address))-before).eq(u(40));
    expect(await c.token.balanceOf(c.contractor.address)).eq(59400000);
    expect(await c.token.balanceOf(c.treasury.address)).eq(600000);
  });
  it("mutual signed settlement works, rejects altered allocations and cannot replay", async () => {
    const c=await loadFixture(funded), sig=await signatures(c,1,u(100));
    await expect(c.vault.settleByAgreement(c.id,1,u(99),...sig)).revertedWith("Buyer consent required");
    await expect(c.vault.settleByAgreement(c.id,0,u(100),...sig)).revertedWith("Buyer consent required");
    await c.vault.connect(c.stranger).settleByAgreement(c.id,1,u(100),...sig);
    expect(await c.token.balanceOf(c.contractor.address)).eq(148500000);
    await expect(c.vault.settleByAgreement(c.id,1,u(100),...sig)).reverted;
  });
  it("requires both valid signatures and rejects expired consent", async () => {
    const c=await loadFixture(funded), sig=await signatures(c,0,u(100));
    await expect(c.vault.settleByAgreement(c.id,0,u(100),sig[0],sig[1],"0x")).revertedWith("Contractor consent required");
    await time.increase(3601);
    await expect(c.vault.settleByAgreement(c.id,0,u(100),...sig)).revertedWith("Invalid expiry");
  });
  it("conserves all funds across release, refund and partial settlement", async () => {
    const c=await loadFixture(funded); await c.deliver(0); await c.vault.releaseMilestone(c.id,0);
    await c.vault.settleByAgreement(c.id,1,u(100),...await signatures(c,1,u(100)));
    await c.vault.settleByAgreement(c.id,2,u(150),...await signatures(c,2,u(150)));
    expect(await c.token.balanceOf(c.contractor.address)).eq(247500000);
    expect(await c.token.balanceOf(c.treasury.address)).eq(2500000);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(0);
    expect((await c.vault.projects(c.id)).remaining).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(0);
  });
  it("allocates fee rounding exactly, including tiny base-unit allocations", async () => {
    const c=await loadFixture(fixture);
    for (const amounts of [[1n,1n,99n],[101n,251n,153n],[999999n,2n,1n]]) {
      const id=ethers.concat([c.buyer.address,ethers.randomBytes(12)]);
      await c.propose(false,amounts.map((amount,i)=>({...c.inputs[i],amount})),id);
      const p=await c.vault.projects(id); let totalFee=0n;
      for(let i=0;i<3;i++) {const m=await c.vault.milestones(id,i); totalFee+=m.reservedFee; expect(m.reservedFee).lte(m.amount);}
      expect(totalFee).eq(p.reservedFee); expect(totalFee).eq(p.total/100n);
    }
  });
  it("rejects invalid counts, allocations, review windows and reviewer conflicts", async () => {
    const c=await loadFixture(fixture);
    await expect(c.propose(false,[])).revertedWith("Invalid milestone count");
    await expect(c.propose(false,Array(21).fill(c.inputs[0]))).revertedWith("Invalid milestone count");
    await expect(c.propose(false,[{...c.inputs[0],amount:0}])).revertedWith("Invalid milestone");
    await expect(c.propose(false,[{...c.inputs[0],duration:0}])).revertedWith("Invalid duration");
    for (const a of [c.buyer.address,c.contractor.address,c.treasury.address,c.primary.address,ethers.ZeroAddress,await c.vault.getAddress()]) {
      await expect(c.propose(false,c.inputs,c.id,a)).revertedWith("Independent reviewer conflict");
    }
    await expect(c.Factory.deploy(c.treasury.address,c.primary.address,301,[await c.token.getAddress()],"0x000000000000000000000000000000000000a110")).revertedWith("Fee exceeds cap");
  });
  it("does not accept expired proposals, repeat delivery or invalid indexes", async () => {
    const c=await loadFixture(fixture); await c.propose(); await time.increase(day+1);
    await expect(c.accept()).revertedWith("Acceptance closed");
    const f=await loadFixture(funded); await f.deliver(0);
    await expect(f.deliver(0)).revertedWith("Delivery closed");
    await expect(f.vault.releaseMilestone(f.id,3)).revertedWith("Unknown funded milestone");
  });
  it("rejects fee-on-transfer deposits without leaving a funded project", async () => {
    const c=await loadFixture(fixture);
    const token=await (await ethers.getContractFactory("MockFeeOnTransferERC20")).deploy("Taxed","TAX",6,100);
    const vault=await c.Factory.deploy(c.treasury.address,c.primary.address,100,[await token.getAddress()],"0x000000000000000000000000000000000000a110");
    await vault.proposeProject(c.id,c.contractor.address,await token.getAddress(),c.independent.address,
      c.inputs,false,day,day,(await time.latest())+day,day);
    const hash=(await vault.projects(c.id)).termsHash;
    await vault.connect(c.contractor).acceptProject(c.id,hash); await token.approve(await vault.getAddress(),u(500));
    await expect(vault.fundProject(c.id,hash)).revertedWith("Exact transfer required");
    expect((await vault.projects(c.id)).fundedAt).eq(0);
    expect(await token.balanceOf(await vault.getAddress())).eq(0);
    expect(await vault.tokenLiability(await token.getAddress())).eq(0);
  });
  it("cannot consume another project's funds", async () => {
    const c=await loadFixture(funded), other=ethers.concat([c.buyer.address,ethers.randomBytes(12)]);
    await c.propose(false,c.inputs,other); await c.accept(other); await c.fund(other);
    for(let i=0;i<3;i++) {await c.deliver(i); await c.vault.releaseMilestone(c.id,i);}
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(u(500));
    expect((await c.vault.projects(other)).remaining).eq(u(500));
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(u(500));
  });
  it("prior unsolicited donations cannot block funding or inflate milestone credit", async () => {
    const c=await loadFixture(fixture);
    await c.token.transfer(await c.vault.getAddress(),123);
    await c.propose(); await c.accept(); await c.fund();
    expect((await c.vault.projects(c.id)).remaining).eq(u(500));
    for(let i=0;i<3;i++) {await c.deliver(i); await c.vault.releaseMilestone(c.id,i);}
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(123);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(0);
  });
});
