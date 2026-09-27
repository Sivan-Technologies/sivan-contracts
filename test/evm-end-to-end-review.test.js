const { testAgreementId } = require("./helpers/agreement-id");
const { signProof } = require("./helpers/attester-proof");
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { fund } = require("./helpers/fund");
const { preflight, deployAndSeed } = require("../scripts/helpers/evm-deployment");
const { getNetwork } = require("../config/evm-networks.cjs");

describe("Deployment-to-settlement review (local test tokens only)", () => {
  for (const route of ["delivered", "refund", "primary", "independent", "bilateral"]) {
    it(`verifies journal, funding and exact payout through ${route}`, async () => {
      const [owner,buyer,contractor,collector,agent,partner,,,,independent] = await ethers.getSigners();
      const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
      const fqn="contracts/SivanAgreementVault.sol:SivanAgreementVault";
      const artifact=await hre.artifacts.readArtifact(fqn),build=await hre.artifacts.getBuildInfo(fqn);
      const network={...getNetwork("celoSepolia"),chainId:31337};
      const config={feeCollector:collector.address,agentAttester:agent.address,agentId:"1",version:"v1",tokens:[{address:await token.getAddress(),symbol:"USDC",decimals:6}]};
      await signProof(network, config, owner.address, artifact, agent);
      await preflight({network,config,provider:ethers.provider,deployer:owner.address,artifact,build});
      const record={phase:"preflight"};
      const vault=await deployAndSeed({network,config,signer:owner,artifact,record,save:()=>{}});
      expect(record.phase).to.equal("deployed-verified-readback");
      const id=testAgreementId(route),amount=100000000n;
      await token.mint(buyer.address,amount);
      await token.connect(buyer).approve(record.vault,amount);
      await fund(vault.connect(buyer),id,contractor.address,await token.getAddress(),amount,24,partner.address);
      const a=await vault.getAgreement(id);
      const domain={name:"Sivan Celo Settlement Facility",version:"1",chainId:31337,verifyingContract:record.vault};
      let refund=0n;
      if(route==="delivered") {
        await vault.connect(contractor).markDelivered(id,"review-proof");
        const signature=await agent.signTypedData(domain,{AgentAttestation:[{name:"agreementId",type:"bytes32"},{name:"agentId",type:"uint256"},{name:"deliverableHash",type:"bytes32"},{name:"timestamp",type:"uint256"}]},
          {agreementId:id,agentId:1,deliverableHash:ethers.keccak256(ethers.toUtf8Bytes("review-proof")),timestamp:a.deadlineTimestamp});
        await vault.connect(buyer).releasePayment(id,"0x",signature,0);
      } else if(route==="refund") {
        await ethers.provider.send("evm_setNextBlockTimestamp",[Number(a.refundUnlockAt)+1]);
        await vault.connect(buyer).refundBuyer(id);
        refund=amount;
      } else {
        await vault.connect(buyer).raiseDispute(id,"review evidence");
        await expect(vault.connect(buyer).refundBuyer(id)).to.be.reverted;
        if(route==="primary") await vault.resolveDispute(id,true,"primary ruling");
        if(route==="independent") {
          const review=await vault.arbitrationCases(id);
          await ethers.provider.send("evm_setNextBlockTimestamp",[Number(review.primaryDeadline)]);
          await vault.claimArbitrationTimeout(id);
          await expect(vault.connect(buyer).refundBuyer(id)).to.be.reverted;
          await vault.setFeeCollector(independent.address);
          await vault.connect(independent).resolveDispute(id,true,"independent ruling");
          expect(await token.balanceOf(independent.address)).to.equal(0);
        }
        if(route==="bilateral") {
          refund=40000000n;
          const expiry=(await ethers.provider.getBlock("latest")).timestamp+3600;
          const types={DisputeSettlement:[{name:"agreementId",type:"bytes32"},{name:"buyerRefund",type:"uint256"},{name:"nonce",type:"uint256"},{name:"expiry",type:"uint256"}]};
          const value={agreementId:id,buyerRefund:refund,nonce:await vault.agreementNonces(id),expiry};
          const b=await buyer.signTypedData(domain,types,value),c=await contractor.signTypedData(domain,types,value);
          await vault.settleDisputeByAgreement(id,refund,expiry,b,c);
          await expect(vault.settleDisputeByAgreement(id,refund,expiry,b,c)).to.be.reverted;
        }
      }
      const fee=a.feeAmount*(amount-refund)/amount,partnerFee=a.partnerFeeAmount*(amount-refund)/amount;
      expect(await token.balanceOf(buyer.address)).to.equal(refund);
      expect(await token.balanceOf(contractor.address)).to.equal(amount-refund-fee);
      expect(await token.balanceOf(collector.address)).to.equal(fee-partnerFee);
      expect(await token.balanceOf(partner.address)).to.equal(partnerFee);
      expect(await token.balanceOf(record.vault)).to.equal(0);
      expect((await vault.getAgreement(id)).state).to.equal(refund===amount?4:3);
      await expect(vault.connect(buyer).releasePayment(id,"0x","0x",0)).to.be.reverted;
    });
  }
});
