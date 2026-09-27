const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { getNetwork } = require("../config/evm-networks.cjs");
const { attesterChallenge, verifyAttesterProof, deployAndSeed } = require("../scripts/helpers/evm-deployment");
const { signProof } = require("./helpers/attester-proof");
const { agreementId } = require("../scripts/helpers/agreement-id");
const { checkLocalFork } = require("../scripts/check-local-fork");

describe("Deployment remediation boundaries", () => {
  let args, agent, owner, collector, config, artifact, network;
  beforeEach(async () => {
    [owner, , , collector, agent] = await ethers.getSigners();
    artifact = await hre.artifacts.readArtifact("SivanAgreementVault");
    network = {...getNetwork("celoSepolia"), chainId:31337};
    config = {feeCollector:collector.address, agentAttester:agent.address, agentId:"1", version:"v2",
      tokens:[{address:collector.address,symbol:"USDC",decimals:6}]};
    await signProof(network,config,owner.address,artifact,agent);
    args = {network,config,artifact,deployer:owner.address,provider:ethers.provider};
  });
  it("accepts the intended ECDSA signer without sharing its private key", async () => {
    await verifyAttesterProof(args);
    expect(attesterChallenge(args)).to.include("deployment attester control proof");
  });
  it("rejects missing, malformed and wrong-signer proofs", async () => {
    for (const proof of [undefined,"0x1234",await owner.signMessage(attesterChallenge(args))]) {
      await expect(verifyAttesterProof({...args,config:{...config,attesterProof:proof}})).to.be.rejected;
    }
  });
  it("binds proofs to chain, deployer, version, roles, token metadata and bytecode", async () => {
    const variants = [
      {...args,network:{...network,chainId:84532}},
      {...args,deployer:config.feeCollector},
      {...args,artifact:{...artifact,bytecode:artifact.bytecode+"00"}},
      ...[{version:"v3"},{feeCollector:owner.address},{agentId:"2"},
        {tokens:[{...config.tokens[0],symbol:"USDT"}]},
        {attesterProofExpiry:String(Number(config.attesterProofExpiry)+1)}]
        .map(change=>({...args,config:{...config,...change}})),
    ];
    for(const variant of variants) await expect(verifyAttesterProof(variant)).to.be.rejectedWith("signer mismatch");
  });
  it("rejects expired, nonnumeric and overlong proof lifetimes", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    for(const expiry of [String(now),String(now-1),String(now+86401),"garbage",undefined]) {
      await expect(verifyAttesterProof({...args,config:{...config,attesterProofExpiry:expiry}})).to.be.rejectedWith("expiry");
    }
  });
  it("rechecks proof before any journal intent or deployment broadcast", async () => {
    config.attesterProof = "0x";
    const before = await owner.getNonce(); let saves = 0;
    await expect(deployAndSeed({network,config,artifact,signer:owner,record:{phase:"preflight"},save:()=>{saves++;}})).to.be.rejected;
    expect(saves).to.equal(0);
    expect(await owner.getNonce()).to.equal(before);
  });
  it("matches Solidity buyer namespace derivation and rejects invalid inputs", async () => {
    const [o,b,,c,a] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory("SivanAgreementVault")).deploy(c.address,a.address,1,o.address);
    const nonce = ethers.hexlify(ethers.randomBytes(12));
    expect(await vault.deriveAgreementId(b.address,nonce)).to.equal(agreementId(b.address,nonce));
    expect(agreementId(o.address,nonce)).not.to.equal(agreementId(b.address,nonce));
    expect(()=>agreementId(ethers.ZeroAddress,nonce)).to.throw();
    expect(()=>agreementId(b.address,"0x00")).to.throw();
    await expect(vault.deriveAgreementId(ethers.ZeroAddress,nonce)).to.be.revertedWith("Invalid buyer");
  });
  it("keeps CI transaction traffic confined to its local fork", () => {
    // Deliberate test fixtures, not runtime endpoint defaults.
    expect(()=>checkLocalFork("http://127.0.0.1:8545")).not.to.throw();
    for(const url of [undefined,"https://remote.invalid","http://127.0.0.1:9999","http://user:secret@127.0.0.1:8545","http://127.0.0.1:8545/?redirect=1"]) {
      expect(()=>checkLocalFork(url)).to.throw();
    }
  });
});
