const {expect}=require("chai");
const {ethers}=require("hardhat");
const {time}=require("@nomicfoundation/hardhat-network-helpers");
const DAY=86400;

describe("Milestone deployment-to-settlement end to end (local chain only)",()=>{
  async function setup({decimals=6,count=3,smart=false,adversarial=false,sequential=false}={}) {
    const [buyer,contractor,fee,primary,independent,relay]=await ethers.getSigners();
    const token=adversarial
      ? await (await ethers.getContractFactory("MilestoneAdversarialToken")).deploy()
      : await (await ethers.getContractFactory("MockERC20")).deploy("Test USD","TUSD",decimals);
    const vault=await (await ethers.getContractFactory("SivanMilestoneVault")).deploy(fee.address,primary.address,100,[await token.getAddress()],"0x000000000000000000000000000000000000a110");
    const walletFactory=await ethers.getContractFactory("MilestoneTestWallet");
    const buyerWallet=smart?await walletFactory.deploy(buyer.address):null;
    const contractorWallet=smart?await walletFactory.deploy(contractor.address):null;
    const buyerAddress=smart?await buyerWallet.getAddress():buyer.address;
    const contractorAddress=smart?await contractorWallet.getAddress():contractor.address;
    const id=ethers.concat([buyerAddress,ethers.randomBytes(12)]);
    const unit=10n**BigInt(decimals), amounts=count===3?[100n*unit,250n*unit,150n*unit]:Array(count).fill(25n*unit);
    const inputs=amounts.map((amount,i)=>({amount,duration:7*DAY,scopeHash:ethers.id(`agreed scope ${i}`)}));
    const total=amounts.reduce((a,b)=>a+b,0n);
    await token.mint(buyerAddress,total);
    async function call(actor,method,args) {
      const wallet=actor===buyer?buyerWallet:contractorWallet;
      return wallet?wallet.connect(actor).execute(await vault.getAddress(),vault.interface.encodeFunctionData(method,args))
        :vault.connect(actor)[method](...args);
    }
    await call(buyer,"proposeProject",[id,contractorAddress,await token.getAddress(),independent.address,inputs,sequential,DAY,DAY,(await time.latest())+DAY,DAY]);
    const p=await vault.getProject(id);
    await call(contractor,"acceptProject",[id,p.termsHash]);
    if(smart) await buyerWallet.execute(await token.getAddress(),token.interface.encodeFunctionData("approve",[await vault.getAddress(),total]));
    else await token.approve(await vault.getAddress(),total);
    const receipt=await (await call(buyer,"fundProject",[id,p.termsHash])).wait();
    return {buyer,contractor,fee,primary,independent,relay,token,vault,id,unit,total,amounts,call,receipt,buyerAddress,contractorAddress};
  }
  async function sign(c,index,refund,domainOverrides={}) {
    const p=await c.vault.getProject(c.id),m=await c.vault.getMilestone(c.id,index),expiry=(await time.latest())+3600;
    const types={MilestoneSettlement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},
      {name:"termsHash",type:"bytes32"},{name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
    const domain={name:"SivanMilestoneVault",version:"1",chainId:31337,verifyingContract:await c.vault.getAddress(),...domainOverrides};
    const value={projectId:c.id,index,termsHash:p.termsHash,buyerRefund:refund,nonce:m.nonce,expiry};
    return [expiry,await c.buyer.signTypedData(domain,types,value),await c.contractor.signTypedData(domain,types,value)];
  }
  for(const decimals of [6,18]) it(`settles the full $500 project with ${decimals}-decimal test tokens and reconciles events`,async()=>{
    const c=await setup({decimals});
    const logs=c.receipt.logs.map(l=>{try{return c.vault.interface.parseLog(l);}catch{return null;}}).filter(Boolean);
    expect(logs.filter(l=>l.name==="ProjectFunded")).length(1);
    const transfers=c.receipt.logs.map(l=>{try{return c.token.interface.parseLog(l);}catch{return null;}}).filter(l=>l?.name==="Transfer");
    expect(transfers).length(1); expect(transfers[0].args.value).eq(c.total);
    for(const index of [2,0,1]) {
      await c.call(c.contractor,"markDelivered",[c.id,index,ethers.id(`proof ${index}`)]);
      const m=await c.vault.getMilestone(c.id,index);
      await expect(c.call(c.buyer,"releaseMilestone",[c.id,index])).emit(c.vault,"MilestoneSettled")
        .withArgs(c.id,index,0,m.amount-m.reservedFee,m.reservedFee);
    }
    expect(await c.token.balanceOf(c.contractorAddress)).eq(495n*c.unit);
    expect(await c.token.balanceOf(c.fee.address)).eq(5n*c.unit);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(0);
    expect((await c.vault.getProject(c.id)).remaining).eq(0);
  });
  it("funds and settles the maximum twenty-milestone project",async()=>{
    const c=await setup({count:20}); expect(c.receipt.gasUsed).lt(3000000n);
    for(let i=19;i>=0;i--) {
      await c.call(c.contractor,"markDelivered",[c.id,i,ethers.id(`proof ${i}`)]);
      await c.call(c.buyer,"releaseMilestone",[c.id,i]);
    }
    expect(await c.token.balanceOf(c.contractorAddress)).eq(495n*c.unit);
    expect((await c.vault.getProject(c.id)).remaining).eq(0);
  });
  it("supports contract-wallet parties and ERC1271 bilateral settlement",async()=>{
    const c=await setup({smart:true});
    await c.call(c.contractor,"markDelivered",[c.id,0,ethers.id("delivered")]);
    await c.call(c.buyer,"releaseMilestone",[c.id,0]);
    const refund=100n*c.unit;
    await c.vault.connect(c.relay).settleByAgreement(c.id,1,refund,...await sign(c,1,refund));
    await c.vault.settleByAgreement(c.id,2,c.amounts[2],...await sign(c,2,c.amounts[2]));
    expect(await c.token.balanceOf(c.contractorAddress)).eq(247500000);
    expect(await c.token.balanceOf(c.fee.address)).eq(2500000);
    expect((await c.vault.getProject(c.id)).remaining).eq(0);
  });
  it("rejects cross-chain and cross-vault consent without consuming nonce",async()=>{
    const c=await setup();
    for(const domain of [{chainId:1},{verifyingContract:c.relay.address}]) {
      await expect(c.vault.settleByAgreement(c.id,0,0,...await sign(c,0,0,domain))).revertedWith("Buyer consent required");
      expect((await c.vault.getMilestone(c.id,0)).nonce).eq(0);
    }
    await c.vault.settleByAgreement(c.id,0,0,...await sign(c,0,0));
  });
  it("supports both contract-wallet signatures for case-scoped reviewer replacement",async()=>{
    const c=await setup({smart:true});
    await c.call(c.buyer,"disputeMilestone",[c.id,0]);
    await time.increase(DAY+1);await c.vault.escalateMilestone(c.id,0);await time.increase(DAY);
    const p=await c.vault.getProject(c.id),expiry=(await time.latest())+3600;
    const domain={name:"SivanMilestoneVault",version:"1",chainId:31337,verifyingContract:await c.vault.getAddress()};
    const types={ReviewerReplacement:[{name:"projectId",type:"bytes32"},{name:"index",type:"uint256"},{name:"termsHash",type:"bytes32"},
      {name:"currentReviewer",type:"address"},{name:"replacement",type:"address"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
    const value={projectId:c.id,index:0,termsHash:p.termsHash,currentReviewer:c.independent.address,replacement:c.relay.address,nonce:0,expiry};
    await c.vault.replaceIndependentReviewer(c.id,0,c.relay.address,expiry,
      await c.buyer.signTypedData(domain,types,value),await c.contractor.signTypedData(domain,types,value));
    expect((await c.vault.getMilestone(c.id,0)).activeReviewer).eq(c.relay.address);
    expect(await c.token.balanceOf(await c.vault.getAddress())).eq(c.total);
    await c.vault.connect(c.relay).resolveMilestone(c.id,0,c.amounts[0]);
    expect(await c.token.balanceOf(c.buyerAddress)).eq(c.amounts[0]);
  });
  it("rolls back state and all transfers when fee payout fails, then safely retries",async()=>{
    const c=await setup({adversarial:true});
    await c.call(c.contractor,"markDelivered",[c.id,0,ethers.id("proof")]);
    await c.token.setBlocked(c.fee.address);
    await expect(c.call(c.buyer,"releaseMilestone",[c.id,0])).revertedWith("Recipient blocked");
    expect((await c.vault.getMilestone(c.id,0)).state).eq(2);
    expect((await c.vault.getMilestone(c.id,0)).nonce).eq(0);
    expect(await c.token.balanceOf(c.contractorAddress)).eq(0);
    expect(await c.vault.tokenLiability(await c.token.getAddress())).eq(c.total);
    await c.token.setBlocked(ethers.ZeroAddress);
    await c.call(c.buyer,"releaseMilestone",[c.id,0]);
    expect(await c.token.balanceOf(c.contractorAddress)).eq(99n*c.unit);
  });
  it("rejects a token callback attempting a valid signed payout during another payout",async()=>{
    const c=await setup({adversarial:true});
    const args=await sign(c,1,0);
    await c.token.setCallback(await c.vault.getAddress(),c.vault.interface.encodeFunctionData("settleByAgreement",[c.id,1,0,...args]));
    await c.call(c.contractor,"markDelivered",[c.id,0,ethers.id("proof")]);
    await c.call(c.buyer,"releaseMilestone",[c.id,0]);
    expect(await c.token.callbackAttempted()).eq(true); expect(await c.token.callbackSucceeded()).eq(false);
    expect((await c.vault.getMilestone(c.id,1)).state).eq(1);
    expect((await c.vault.getProject(c.id)).remaining).eq(400n*c.unit);
    await c.token.setCallback(ethers.ZeroAddress,"0x");
    await c.vault.settleByAgreement(c.id,1,0,...args);
  });
  it("closes sequential disputes and refunds without an earlier milestone blocking recovery",async()=>{
    const c=await setup({sequential:true});
    await c.call(c.buyer,"disputeMilestone",[c.id,0]);
    await c.call(c.buyer,"disputeMilestone",[c.id,2]);
    await time.increase(DAY+1); await c.vault.escalateMilestone(c.id,2);
    await c.vault.connect(c.independent).resolveMilestone(c.id,2,c.amounts[2]);
    expect((await c.vault.getMilestone(c.id,0)).state).eq(3);
    expect((await c.vault.getMilestone(c.id,2)).state).eq(5);
    expect(await c.token.balanceOf(c.fee.address)).eq(0);
  });
});
