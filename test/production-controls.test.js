const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs"), os = require("os"), path = require("path");
const { loadEnvironment } = require("../scripts/helpers/environment");
const { checkControls } = require("../scripts/helpers/control-wallets");
const { configuration, deployAndSeed } = require("../scripts/helpers/evm-deployment");
const { getNetwork } = require("../config/evm-networks.cjs");
const { signProof } = require("./helpers/attester-proof");

describe("Production control boundaries (local only)", () => {
  it("refuses consent changes after funding regardless of token balance or time", async () => {
    const [owner,buyer,contractor,collector,agent]=await ethers.getSigners();
    const vault=await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address,agent.address,1,owner.address);
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
    await vault.setSupportedToken(await token.getAddress(),true);
    await token.mint(buyer.address,1000000);await token.connect(buyer).approve(await vault.getAddress(),1000000);
    const id=require("../scripts/helpers/agreement-id").agreementId(buyer.address);
    await require("./helpers/fund").fund(vault.connect(buyer),id,contractor.address,await token.getAddress(),1000000,24,ethers.ZeroAddress);
    const hash=await vault.arbitrationTermsHash(buyer.address,id);
    await token.mint(await vault.getAddress(),1);
    await ethers.provider.send("evm_increaseTime",[1]);await ethers.provider.send("evm_mine",[]);
    await expect(vault.connect(contractor).acceptArbitrationTerms(buyer.address,id,hash,false)).to.be.revertedWith("Agreement already exists");
  });
  it("never loads developer secrets into production or accepts raw production signing keys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),"sivan-env-test-"));
    try {
      fs.writeFileSync(path.join(dir,".env"),"DEPLOYER_PRIVATE_KEY=test-only-not-a-key\n");
      const prod = {EVM_PROFILE:"production"}; loadEnvironment(prod,dir);
      expect(prod.DEPLOYER_PRIVATE_KEY).to.equal(undefined);
      expect(()=>loadEnvironment({EVM_PROFILE:"production",X_PRIVATE_KEY:"test"},dir)).to.throw("Raw signing");
      fs.writeFileSync(path.join(dir,".env.production"),"X_PRIVATE_KEY=test-only-not-a-key\n");
      expect(()=>loadEnvironment({EVM_PROFILE:"production",X_PRIVATE_KEY:""},dir)).to.throw("Raw signing");
      fs.writeFileSync(path.join(dir,".env.production"),"CELO_RPC_URL=https://rpc.invalid/private-path\n");
      expect(()=>loadEnvironment({EVM_PROFILE:"production"},dir)).to.throw("protected runtime");
      expect(()=>loadEnvironment({EVM_PROFILE:"invalid"},dir)).to.throw("EVM_PROFILE");
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  it("selects testnet configuration explicitly and preserves injected overrides", () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sivan-env-test-"));
    try {
      fs.writeFileSync(path.join(dir,".env"),"VALUE=legacy\n");
      fs.writeFileSync(path.join(dir,".env.testnet"),"VALUE=testnet\n");
      const env={VALUE:"injected"};loadEnvironment(env,dir);expect(env.VALUE).to.equal("injected");
      const fresh={};loadEnvironment(fresh,dir);expect(fresh.VALUE).to.equal("testnet");
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
  it("refuses production configuration even with a candidate testnet alias", () => {
    expect(()=>configuration(getNetwork("celoSepolia"),{EVM_PROFILE:"production"})).to.throw("Production deployment remains disabled");
  });
  it("requires acceptance and removes old admin privileges only after acceptance", async () => {
    const [owner,admin,outsider,collector,agent]=await ethers.getSigners();
    const vault=await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address,agent.address,1,owner.address);
    await vault.transferOwnership(admin.address);
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.pendingOwner()).to.equal(admin.address);
    await expect(vault.connect(outsider).acceptOwnership()).to.be.reverted;
    await expect(vault.connect(admin).pause()).to.be.reverted;
    await vault.connect(admin).acceptOwnership();
    expect(await vault.owner()).to.equal(admin.address);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    await expect(vault.pause()).to.be.reverted;
    await vault.connect(admin).pause();
    await expect(vault.connect(admin).renounceOwnership()).to.be.reverted;
  });
  it("can cancel an incorrect pending admin without losing the current owner", async () => {
    const [owner,admin,,collector,agent]=await ethers.getSigners();
    const vault=await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address,agent.address,1,owner.address);
    await vault.transferOwnership(admin.address);await vault.transferOwnership(ethers.ZeroAddress);
    await expect(vault.connect(admin).acceptOwnership()).to.be.reverted;
    expect(await vault.owner()).to.equal(owner.address);
  });
  it("pauses before allowlisting and leaves handover explicitly awaiting acceptance", async () => {
    const [owner,admin,,collector,agent]=await ethers.getSigners();
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
    const artifact=await hre.artifacts.readArtifact("SivanAgreementVault");
    const network={...getNetwork("celoSepolia"),chainId:31337};
    const config={feeCollector:collector.address,agentAttester:agent.address,agentId:"1",version:"v2",adminAddress:admin.address,
      controlMode:"testnet_eoa",tokens:[{address:await token.getAddress(),symbol:"USDC",decimals:6}]};
    await signProof(network,config,owner.address,artifact,agent);
    const record={phase:"preflight"},phases=[];
    const vault=await deployAndSeed({network,config,signer:owner,artifact,record,save:r=>phases.push(r.phase)});
    expect(phases.indexOf("admin-pause-intent")).to.be.lessThan(phases.indexOf("seed-broadcast-intent"));
    expect(record.phase).to.equal("awaiting-admin-acceptance");
    expect(await vault.paused()).to.equal(true);
    expect(await vault.owner()).to.equal(owner.address);
    await vault.connect(admin).acceptOwnership();
    expect(await vault.paused()).to.equal(true);
    await expect(vault.unpause()).to.be.reverted;
  });
  it("checks multisig code, implementation, owners, threshold and module configuration", async () => {
    const [deployer,agent,...signers]=await ethers.getSigners();
    const owners=signers.slice(0,3).map(s=>s.address);
    const factory=await ethers.getContractFactory("ControlWalletReadbackFixture");
    const treasury=await factory.deploy(owners),admin=await factory.deploy(owners);
    const hash=ethers.keccak256(await ethers.provider.getCode(await treasury.getAddress()));
    const config={controlMode:"multisig",adminAddress:await admin.getAddress(),feeCollector:await treasury.getAddress(),agentAttester:agent.address,
      treasuryPolicy:{owners,codeHash:hash,implementationCodeHash:hash,fallbackCodeHash:ethers.ZeroHash},adminPolicy:{owners,codeHash:hash,implementationCodeHash:hash,fallbackCodeHash:ethers.ZeroHash}};
    const args={config,provider:ethers.provider,deployer:deployer.address};
    expect((await checkControls(args)).treasury.threshold).to.equal(2);
    await expect(checkControls({...args,config:{...config,adminAddress:config.feeCollector}})).to.be.rejectedWith("separate");
    await expect(checkControls({...args,config:{...config,treasuryPolicy:{...config.treasuryPolicy,codeHash:ethers.ZeroHash}}})).to.be.rejectedWith("code hash");
    await expect(checkControls({...args,config:{...config,treasuryPolicy:{...config.treasuryPolicy,owners:[deployer.address,...owners.slice(1)]}}})).to.be.rejectedWith("conflicts");
    await treasury.changeThreshold(1);await expect(checkControls(args)).to.be.rejectedWith("2-of-3");
    await treasury.changeThreshold(2);
    await ethers.provider.send("hardhat_setStorageAt",[config.feeCollector,ethers.id("guard_manager.guard.address"),ethers.zeroPadValue(agent.address,32)]);
    await expect(checkControls(args)).to.be.rejectedWith("guard");
    await ethers.provider.send("hardhat_setStorageAt",[config.feeCollector,ethers.id("guard_manager.guard.address"),ethers.ZeroHash]);
    await ethers.provider.send("hardhat_setStorageAt",[config.feeCollector,ethers.id("fallback_manager.handler.address"),ethers.zeroPadValue(agent.address,32)]);
    await expect(checkControls(args)).to.be.rejectedWith("Fallback");
    await ethers.provider.send("hardhat_setStorageAt",[config.feeCollector,ethers.id("fallback_manager.handler.address"),ethers.ZeroHash]);
    await treasury.enableModule();await expect(checkControls(args)).to.be.rejectedWith("modules");
  });
});
