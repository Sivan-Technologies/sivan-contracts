const { testAgreementId } = require("./helpers/agreement-id");
const { signProof } = require("./helpers/attester-proof");
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { networks, getNetwork, assertDeployable, hardhatNetworks } = require("../config/evm-networks.cjs");
const { configuration, preflight, deployAndSeed } = require("../scripts/helpers/evm-deployment");
const { fund } = require("./helpers/fund");

describe("EVM deployment safeguards (local EVM only)", function () {
  let owner, buyer, contractor, collector, agent, token, artifact, build, env, network, config;
  beforeEach(async () => {
    [owner, buyer, contractor, collector, agent] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    const fqn = "contracts/SivanAgreementVault.sol:SivanAgreementVault";
    artifact = await hre.artifacts.readArtifact(fqn);
    build = await hre.artifacts.getBuildInfo(fqn);
    network = { ...getNetwork("baseSepolia"), chainId: 31337 };
    env = { BASE_SEPOLIA_FEE_COLLECTOR: collector.address, BASE_SEPOLIA_AGENT_ATTESTER: agent.address,
      BASE_SEPOLIA_ADMIN_ADDRESS: owner.address, BASE_SEPOLIA_CONTROL_MODE: "testnet_eoa",
      BASE_SEPOLIA_AGENT_ID: "1", BASE_SEPOLIA_CONTRACT_VERSION: "v1",
      BASE_SEPOLIA_TOKENS_JSON: JSON.stringify([{ address: await token.getAddress(), symbol: "USDC", decimals: 6 }]) };
    config = configuration(network, env);
    await signProof(network, config, owner.address, artifact, agent);
  });
  const fails = async (fn, message) => {
    try { await fn(); } catch (e) { expect(e.message).to.include(message); return; }
    throw new Error("Expected rejection: " + message);
  };
  function check(overrides = {}) {
    return preflight({ network, config, provider: ethers.provider, deployer: owner.address, artifact, build, ...overrides });
  }
  it("blocks every mainnet and pending profile before RPC access", () => {
    for (const n of Object.values(networks)) if (!n.testnet || n.status === "pending") expect(() => assertDeployable(n)).to.throw();
    expect(() => getNetwork("unknown")).to.throw("Unknown");
  });
  it("has no fallback RPC or inherited signing key", () => {
    expect(hardhatNetworks({ DEPLOYER_PRIVATE_KEY: "must-not-be-used" })).to.deep.equal({});
    const result = hardhatNetworks({ BASE_SEPOLIA_RPC_URL: "configured-endpoint" });
    expect(result.baseSepolia.accounts).to.deep.equal([]);
    expect(result.baseSepolia.chainId).to.equal(84532);
  });
  it("requires network-specific settings, not global role fallbacks", () => {
    expect(() => configuration(network, { SIVAN_FEE_COLLECTOR: collector.address })).to.throw("Configure BASE_SEPOLIA_FEE_COLLECTOR");
    expect(() => configuration(network, { ...env, BASE_SEPOLIA_AGENT_ID: "0" })).to.throw("Invalid agent ID");
    expect(() => configuration(network, { ...env, BASE_SEPOLIA_AGENT_ATTESTER: collector.address })).to.throw("separate");
  });
  it("rejects empty, duplicate and malformed token lists", () => {
    for (const value of ["[]", "{}", "bad-json", JSON.stringify([...config.tokens, ...config.tokens]), JSON.stringify([{...config.tokens[0], decimals: 19}])]) {
      expect(() => configuration(network, { ...env, BASE_SEPOLIA_TOKENS_JSON: value })).to.throw();
    }
  });
  it("rejects actual chain mismatches without a transaction", async () => {
    const before = await ethers.provider.getTransactionCount(owner.address);
    await fails(() => check({ network: getNetwork("baseSepolia") }), "chain ID mismatch");
    expect(await ethers.provider.getTransactionCount(owner.address)).to.equal(before);
  });
  it("rejects compiler mismatch, absent token code, wrong metadata and role overlap", async () => {
    await fails(() => check({ network: { ...network, evmVersion: "paris" } }), "Compiler/EVM");
    await fails(() => check({ config: { ...config, tokens: [{ ...config.tokens[0], address: buyer.address }] } }), "no code");
    await fails(() => check({ config: { ...config, tokens: [{ ...config.tokens[0], symbol: "USDT" }] } }), "metadata");
    await fails(() => check({ config: { ...config, feeCollector: owner.address } }), "separate");
  });
  it("simulates deployment without consuming nonce and rejects an unfunded deployer", async () => {
    const before = await ethers.provider.getTransactionCount(owner.address);
    const result = await check();
    expect(BigInt(result.gas)).to.be.greaterThan(0n);
    expect(await ethers.provider.getTransactionCount(owner.address)).to.equal(before);
    await fails(() => check({ deployer: ethers.Wallet.createRandom().address }), "Insufficient");
  });
  for (const name of ["celoSepolia", "baseSepolia", "arbitrumSepolia"]) {
    it(`deploys, journals, seeds and settles locally through the ${name} configuration path`, async () => {
      // Local chain override is deliberate: this is NOT a remote testnet result.
      const profile = { ...getNetwork(name), chainId: 31337 };
      const specific = Object.fromEntries(Object.entries(env).map(([k,v]) => [k.replace("BASE_SEPOLIA", profile.prefix), v]));
      const cfg = configuration(profile, specific);
      await signProof(profile, cfg, owner.address, artifact, agent);
      await check({ network: profile, config: cfg });
      const snapshots = [], record = { phase: "preflight" };
      const vault = await deployAndSeed({ network: profile, config: cfg, signer: owner, artifact, record,
        save: r => snapshots.push(JSON.parse(JSON.stringify(r))) });
      expect(record.phase).to.equal("deployed-verified-readback");
      expect(record.sourceVerification).to.equal("pending");
      expect(record.runtimeHash).to.equal(ethers.keccak256(await ethers.provider.getCode(record.vault)));
      expect(snapshots[0].phase).to.equal("deployment-broadcast-intent");
      expect(await vault.tokenAllowlistEnforced()).to.equal(true);
      const amount = 100000000n, id = testAgreementId(name);
      await token.mint(buyer.address, amount);
      await token.connect(buyer).approve(record.vault, amount);
      await fund(vault.connect(buyer), id, contractor.address, await token.getAddress(), amount, 24, ethers.ZeroAddress);
      const a = await vault.getAgreement(id);
      await vault.connect(buyer).releasePayment(id, "0x", "0x", 0);
      expect(await token.balanceOf(contractor.address)).to.equal(a.netAmount);
      expect(await token.balanceOf(collector.address)).to.equal(a.feeAmount);
      expect(await token.balanceOf(record.vault)).to.equal(0);
      await fails(() => deployAndSeed({ network: profile, config: cfg, signer: owner, artifact, record, save: () => {} }), "Do not restart");
    });
  }
  it("does not broadcast if journaling fails", async () => {
    const before = await ethers.provider.getTransactionCount(owner.address);
    await fails(() => deployAndSeed({ network, config, signer: owner, artifact, record: { phase: "preflight" }, save: () => { throw new Error("disk failed"); } }), "disk failed");
    expect(await ethers.provider.getTransactionCount(owner.address)).to.equal(before);
  });
});
