const { testAgreementId } = require("./helpers/agreement-id");
// Regression tests for the previously reproduced security findings.
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { fund } = require("./helpers/fund");
const { configuration, preflight, deployAndSeed } = require("../scripts/helpers/evm-deployment");
const { getNetwork, hardhatNetworks } = require("../config/evm-networks.cjs");

describe("Security review 2026-09-26: remediation regressions", () => {
  it("CI supplies the fork profile setting and guards the local transaction endpoint", () => {
    expect(hardhatNetworks({})).not.to.have.property("celofork");
    const fs = require("fs");
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).to.include("--network celofork");
    expect(workflow).to.include("CELO_FORK_RPC_URL");
    expect(workflow).to.include("node scripts/check-local-fork.js");
    expect(workflow).to.include("contents: read");
    for(const match of workflow.matchAll(/uses:\s+[^@\s]+@([^\s]+)/g)) expect(match[1]).to.match(/^[a-f0-9]{40}$/);
  });

  it("rejects a non-signing token contract as attester before broadcasting", async () => {
    const [owner, buyer, contractor, collector, wrongAttester] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const address = await token.getAddress();
    const network = { ...getNetwork("baseSepolia"), chainId: 31337 };
    const config = configuration(network, {
      BASE_SEPOLIA_FEE_COLLECTOR: collector.address, BASE_SEPOLIA_AGENT_ATTESTER: address,
      BASE_SEPOLIA_ADMIN_ADDRESS: owner.address, BASE_SEPOLIA_CONTROL_MODE: "testnet_eoa",
      BASE_SEPOLIA_AGENT_ID: "1", BASE_SEPOLIA_CONTRACT_VERSION: "v1",
      BASE_SEPOLIA_TOKENS_JSON: JSON.stringify([{address, symbol:"USDC", decimals:6}]),
    });
    const fqn = "contracts/SivanAgreementVault.sol:SivanAgreementVault";
    const artifact = await hre.artifacts.readArtifact(fqn), build = await hre.artifacts.getBuildInfo(fqn);
    config.attesterProofExpiry = String((await ethers.provider.getBlock("latest")).timestamp + 3600);
    const before = await owner.getNonce();
    await expect(preflight({ network, config, provider: ethers.provider, deployer: owner.address, artifact, build })).to.be.rejectedWith("ECDSA account");
    await expect(deployAndSeed({ network, config, signer: owner, artifact, record: {phase:"preflight"}, save:()=>{} })).to.be.rejectedWith("ECDSA account");
    expect(await owner.getNonce()).to.equal(before);
  });

  it("another pair cannot occupy the buyer's accepted agreement ID", async () => {
    const [owner,buyer,contractor,collector,agent,attacker,accomplice,independent] = await ethers.getSigners();
    const token=await (await ethers.getContractFactory("MockERC20")).deploy("USDC","USDC",6);
    const vault=await (await ethers.getContractFactory("SivanAgreementVault")).deploy(collector.address,agent.address,1,owner.address);
    await vault.setSupportedToken(await token.getAddress(),true);
    const id=testAgreementId("public-agreed-id"), amount=100000000n;
    await token.mint(buyer.address,amount);
    await token.connect(buyer).approve(await vault.getAddress(),amount);
    const hash=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address","uint256","uint256","address"],[await token.getAddress(),amount,24,ethers.ZeroAddress]));
    await vault.connect(buyer).proposeArbitrationTerms(id,contractor.address,independent.address,86400,hash,(await ethers.provider.getBlock("latest")).timestamp+3600);
    await vault.connect(contractor).acceptArbitrationTerms(buyer.address,id,await vault.arbitrationTermsHash(buyer.address,id),true);
    await token.mint(attacker.address,1);
    await token.connect(attacker).approve(await vault.getAddress(),1);
    await expect(fund(vault.connect(attacker),id,accomplice.address,await token.getAddress(),1,24,ethers.ZeroAddress)).to.be.revertedWith("Agreement ID must belong to buyer");
    await expect(vault.connect(attacker).deposit(id,accomplice.address,await token.getAddress(),1,24,ethers.ZeroAddress)).to.be.revertedWith("Agreement ID must belong to buyer");
    const ownId = testAgreementId("public-agreed-id", attacker.address);
    expect(ownId).not.to.equal(id);
    await fund(vault.connect(attacker),ownId,accomplice.address,await token.getAddress(),1,24,ethers.ZeroAddress);
    await vault.connect(buyer).deposit(id,contractor.address,await token.getAddress(),amount,24,ethers.ZeroAddress);
    expect((await vault.getAgreement(id)).buyer).to.equal(buyer.address);
    expect((await vault.getAgreement(ownId)).buyer).to.equal(attacker.address);
  });
});
