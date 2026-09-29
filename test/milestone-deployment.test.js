const {expect}=require("chai");
const hre=require("hardhat");
const {ethers}=hre;
const {time,loadFixture}=require("@nomicfoundation/hardhat-network-helpers");
const {getNetwork}=require("../config/evm-networks.cjs");
const {configuration,challenge,verifyProof,preflight,deploy,FQN,ACK}=require("../scripts/helpers/milestone-deployment");
const {requireConfirmation}=require("../scripts/milestone-evm");
describe("Protected milestone deployment (local only)",()=>{
  async function fixture() {
    const [signer,treasury,reviewer,buyer,contractor,independent]=await ethers.getSigners();
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
    const network={...getNetwork("celoSepolia"),chainId:31337};
    const env={EVM_PROFILE:"testnet",SIVAN_FEE_COLLECTOR:treasury.address,CELO_SEPOLIA_MILESTONE_PRIMARY_REVIEWER:reviewer.address,
      CELO_SEPOLIA_MILESTONE_FEE_BPS:"100",CELO_SEPOLIA_MILESTONE_VERSION:"v1",CELO_SEPOLIA_MILESTONE_RISK_ACK:ACK,
      CELO_SEPOLIA_MILESTONE_CONTROL_MODE:"testnet_eoa",CELO_SEPOLIA_MILESTONE_REVIEWER_PROOF_EXPIRY:String((await time.latest())+3600),
      CELO_SEPOLIA_MILESTONE_TOKENS_JSON:JSON.stringify([{address:await token.getAddress(),symbol:"USDC",decimals:6}])};
    const config=configuration(network,env),artifact=await hre.artifacts.readArtifact(FQN),build=await hre.artifacts.getBuildInfo(FQN);
    const args={network,config,provider:ethers.provider,deployer:signer.address,artifact,build};
    config.proof=await reviewer.signMessage(challenge(args));
    return {...args,env,signer,treasury,reviewer,buyer,contractor,independent,token};
  }
  it("blocks production, mainnet, pending networks and missing risk consent",async()=>{
    const c=await loadFixture(fixture);
    expect(()=>configuration(c.network,{...c.env,EVM_PROFILE:"production"})).throws("production deployment disabled");
    for(const n of ["celo","base","optimismSepolia"]) expect(()=>configuration(getNetwork(n),c.env)).throws();
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_RISK_ACK:"yes"})).throws("acknowledgement");
  });
  it("requires separate valid roles, explicit capped fees and valid tokens",async()=>{
    const c=await loadFixture(fixture);
    for(const value of ["301","-1","1.5","NaN",""]) expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_FEE_BPS:value})).throws();
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_PRIMARY_REVIEWER:c.treasury.address})).throws("separate");
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_TOKENS_JSON:"[]"})).throws();
    const tokens=JSON.parse(c.env.CELO_SEPOLIA_MILESTONE_TOKENS_JSON);
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_TOKENS_JSON:JSON.stringify([...tokens,...tokens])})).throws("Duplicate");
  });
  it("preflights without any transaction and rejects chain/artifact mismatches",async()=>{
    const c=await loadFixture(fixture),nonce=await c.signer.getNonce();
    expect((await preflight(c)).controls.mode).eq("testnet_eoa");
    expect(await c.signer.getNonce()).eq(nonce);
    await expect(preflight({...c,network:getNetwork("celoSepolia")})).rejectedWith("chain mismatch");
    await expect(preflight({...c,artifact:await hre.artifacts.readArtifact("SivanAgreementVault")})).rejectedWith("Wrong milestone artifact");
  });
  it("binds reviewer proof to roles, fees, artifact and expiry",async()=>{
    const c=await loadFixture(fixture);
    await expect(preflight({...c,config:{...c.config,feeBps:200}})).rejectedWith("proof invalid");
    await expect(preflight({...c,config:{...c.config,proof:"0x"}})).rejectedWith("proof invalid");
    await expect(preflight({...c,config:{...c.config,proofExpiry:"1"}})).rejectedWith("expire within");
    await expect(preflight({...c,config:{...c.config,proofExpiry:String((await time.latest())+90000)}})).rejectedWith("expire within");
  });
  it("rejects unexpected token metadata and missing gas",async()=>{
    const c=await loadFixture(fixture);
    await expect(preflight({...c,config:{...c.config,tokens:[{...c.config.tokens[0],decimals:18}]}})).rejectedWith("metadata mismatch");
    const deployer=ethers.Wallet.createRandom().address, config={...c.config};
    config.proof=await c.reviewer.signMessage(challenge({...c,deployer,config}));
    await expect(preflight({...c,deployer,config})).rejectedWith("Insufficient");
  });
  it("requires milestone-specific confirmation rather than single-job confirmation",async()=>{
    const c=await loadFixture(fixture);
    expect(()=>requireConfirmation(c.network,c.config,{EVM_DEPLOY_CONFIRM:"celoSepolia:31337:v1"})).throws();
    expect(()=>requireConfirmation(c.network,c.config,{MILESTONE_DEPLOY_CONFIRM:"milestone:celoSepolia:31337:v1"})).not.throws();
  });
  it("validates ERC1271 reviewer consent without treating the test wallet as a reviewed multisig",async()=>{
    const c=await loadFixture(fixture);
    const wallet=await (await ethers.getContractFactory("MilestoneTestWallet")).deploy(c.reviewer.address);
    const config={...c.config,primaryReviewer:await wallet.getAddress()};
    config.proof=await c.reviewer.signMessage(challenge({...c,config}));
    await verifyProof({...c,config});
    await expect(preflight({...c,config})).rejectedWith("require multisig policy review");
    await expect(verifyProof({...c,config:{...config,proof:"0x"}})).rejectedWith("proof invalid");
  });
  it("uses collector precedence without borrowing single-job reviewer or signer fields",async()=>{
    const c=await loadFixture(fixture);
    expect(configuration(c.network,{...c.env,CELO_SEPOLIA_FEE_COLLECTOR:c.buyer.address}).feeCollector).eq(c.buyer.address);
    expect(configuration(c.network,{...c.env,CELO_SEPOLIA_FEE_COLLECTOR:c.buyer.address,
      CELO_SEPOLIA_MILESTONE_FEE_COLLECTOR:c.contractor.address}).feeCollector).eq(c.contractor.address);
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_FEE_COLLECTOR:"bad"})).throws();
    expect(()=>configuration(c.network,{...c.env,CELO_SEPOLIA_MILESTONE_PRIMARY_REVIEWER:"",
      CELO_SEPOLIA_ADMIN_ADDRESS:c.reviewer.address})).throws("PRIMARY_REVIEWER");
  });
  it("fails before broadcasting if journal persistence fails",async()=>{
    const c=await loadFixture(fixture),nonce=await c.signer.getNonce();
    await expect(deploy({...c,record:{phase:"preflight"},save:()=>{throw Error("disk failure");}})).rejectedWith("disk failure");
    expect(await c.signer.getNonce()).eq(nonce);
  });
  it("rechecks reviewer proof before broadcasting and refuses partial-run restart",async()=>{
    const c=await loadFixture(fixture);
    await expect(deploy({...c,record:{phase:"deployment-broadcast-intent"},save:()=>{}})).rejectedWith("do not retry blindly");
    const nonce=await c.signer.getNonce();
    await expect(deploy({...c,config:{...c.config,proof:"0x"},record:{phase:"preflight"},save:()=>{}})).rejectedWith("proof invalid");
    expect(await c.signer.getNonce()).eq(nonce);
  });
  it("deploys, journals constructor roles/allowlist, then funds and settles locally",async()=>{
    const c=await loadFixture(fixture),record={phase:"preflight"},phases=[];
    const vault=await deploy({...c,record,save:r=>phases.push(r.phase)});
    expect(phases[0]).eq("deployment-broadcast-intent");expect(record.phase).eq("deployed-verified-readback");
    expect(record.readyForUse).eq(false);expect(record.sourceVerification).eq("pending");
    expect(record.runtimeHash).eq(ethers.keccak256(await ethers.provider.getCode(record.vault)));
    const id=await vault.deriveProjectId(c.buyer.address,"0x000000000000000000000001"),amount=100000000n;
    await vault.connect(c.buyer).proposeProject(id,c.contractor.address,await c.token.getAddress(),c.independent.address,
      [{amount,duration:86400,scopeHash:ethers.id("scope")}],false,86400,86400,(await time.latest())+3600);
    const p=await vault.getProject(id);await vault.connect(c.contractor).acceptProject(id,p.termsHash);
    await c.token.mint(c.buyer.address,amount);await c.token.connect(c.buyer).approve(record.vault,amount);
    await vault.connect(c.buyer).fundProject(id,p.termsHash);
    await vault.connect(c.contractor).markDelivered(id,0,ethers.id("proof"));await vault.connect(c.buyer).releaseMilestone(id,0);
    expect(await c.token.balanceOf(c.contractor.address)).eq(99000000);expect(await c.token.balanceOf(c.treasury.address)).eq(1000000);
    expect(await c.token.balanceOf(record.vault)).eq(0);
  });
});
