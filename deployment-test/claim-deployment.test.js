const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { getNetwork } = require("../config/evm-networks.cjs");
const { FQN, ACK, configuration, challenge, requireConfirmation, preflight, readback, deploy } = require("../scripts/helpers/claim-deployment");

describe("Claim deployment tooling — ephemeral test chain only", function () {
  let env, config, artifact, build, token, signer, admin, treasury;
  const network = getNetwork(process.env.CLAIM_TEST_NETWORK || "celoSepolia");
  before(async function () {
    if (hre.network.name !== "hardhat" || (await ethers.provider.getNetwork()).chainId !== BigInt(network.chainId))
      throw new Error("Run only with config/claim-local-test.cjs on ephemeral hardhat");
    [, admin, treasury] = await ethers.getSigners();
    signer = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [signer.address, "0x56BC75E2D63100000"]);
    token = await ethers.deployContract("MockERC20", ["Local USDC fixture", "USDC", 6]);
    artifact = await hre.artifacts.readArtifact(FQN);
    build = await hre.artifacts.getBuildInfo(FQN);
    env = { EVM_PROFILE: "testnet", CELO_SEPOLIA_CLAIM_ADMIN: admin.address,
      CELO_SEPOLIA_CLAIM_TREASURY: treasury.address, CELO_SEPOLIA_CLAIM_DEPLOYER_ADDRESS: signer.address,
      CELO_SEPOLIA_CLAIM_CONTROL_MODE: "testnet_eoa", CELO_SEPOLIA_CLAIM_VERSION: "v1", CELO_SEPOLIA_CLAIM_RISK_ACK: ACK,
      CELO_SEPOLIA_CLAIM_TOKENS_JSON: JSON.stringify([{ address: token.target, symbol: "USDC", decimals: 6,
        codeHash: ethers.keccak256(await ethers.provider.getCode(token.target)) }]) };
    env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.replace(/^CELO_SEPOLIA_/, network.prefix + "_"), value]));
    config = configuration(network, env);
  });
  const args = () => ({ network, config, provider: ethers.provider, artifact, build });
  it("blocks mainnet, production profile and pending chains", function () {
    expect(() => configuration(getNetwork("celo"), env)).to.throw("Mainnet");
    expect(() => configuration(network, { ...env, EVM_PROFILE: "production" })).to.throw("testnet profile");
    // arcTestnet is now a candidate; remaining pending networks still throw.
    for (const name of ["bscTestnet", "polygonAmoy", "optimismSepolia", "ethereumSepolia", "lineaTestnet", "sonicTestnet"])
      expect(() => configuration(getNetwork(name), env)).to.throw("pending");
  });
  it("rejects conflicting roles, invalid tokens and duplicate tokens", function () {
    expect(() => configuration(network, { ...env, [`${network.prefix}_CLAIM_ADMIN`]: treasury.address })).to.throw("Separate");
    expect(() => configuration(network, { ...env, [`${network.prefix}_CLAIM_TOKENS_JSON`]: "[]" })).to.throw("1..20");
    const tokens = JSON.parse(env[`${network.prefix}_CLAIM_TOKENS_JSON`]);
    expect(() => configuration(network, { ...env, [`${network.prefix}_CLAIM_TOKENS_JSON`]: JSON.stringify([...tokens, ...tokens]) })).to.throw("Duplicate");
  });
  it("binds explicit approval to the exact roles, tokens and artifact", function () {
    const approval = challenge(network, config, artifact);
    expect(() => requireConfirmation(network, config, artifact, approval)).not.to.throw();
    expect(() => requireConfirmation(network, { ...config, version: "v2" }, artifact, approval)).to.throw("challenge");
    expect(() => requireConfirmation(network, config, artifact, undefined)).to.throw("challenge");
  });
  it("rejects an RPC reporting mainnet before any other RPC access", async function () {
    await expect(preflight({ ...args(), provider: { send: async () => "0xa4ec" } })).to.be.rejectedWith("chain mismatch");
  });
  it("checks actual token metadata and runtime identity", async function () {
    const bad = { ...config, tokens: [{ ...config.tokens[0], decimals: 18 }] };
    await expect(preflight({ ...args(), config: bad })).to.be.rejectedWith("metadata mismatch");
    bad.tokens[0] = { ...config.tokens[0], codeHash: ethers.id("wrong") };
    await expect(preflight({ ...args(), config: bad })).to.be.rejectedWith("runtime mismatch");
  });
  it("rejects wrong artifacts and unreviewed contract control wallets", async function () {
    await expect(preflight({ ...args(), artifact: { ...artifact, contractName: "SivanAgreementVault" } })).to.be.rejectedWith("artifact/compiler");
    await expect(preflight({ ...args(), config: { ...config, admin: token.target } })).to.be.rejectedWith("reviewed multisig");
  });
  it("checks deployment gas reserve", async function () {
    await expect(preflight({ ...args(), config: { ...config, deployer: ethers.Wallet.createRandom().address } })).to.be.rejectedWith("gas reserve");
    expect((await preflight(args())).gas).to.match(/^[1-9][0-9]*$/);
  });
  it("cannot deploy without approval or reuse a partial journal", async function () {
    await expect(deploy({ ...args(), signer, record: { phase: "preflight" } })).to.be.rejectedWith("challenge");
    await expect(deploy({ ...args(), signer, record: { phase: "broadcast-intent" }, confirmation: challenge(network, config, artifact) })).to.be.rejectedWith("partial");
  });
  it("stops before broadcast when the durable journal cannot be saved", async function () {
    const nonce = await signer.getNonce("pending");
    await expect(deploy({ ...args(), signer, record: { phase: "preflight" }, confirmation: challenge(network, config, artifact),
      save: async () => { throw new Error("disk unavailable"); } })).to.be.rejectedWith("disk unavailable");
    expect(await signer.getNonce("pending")).to.equal(nonce);
  });
  it("deploys locally, journals before broadcast, reads back roles and recovers by receipt", async function () {
    const records = [], record = { phase: "preflight", config, abi: artifact.abi };
    await ethers.provider.send("evm_setIntervalMining", [100]);
    try {
      await deploy({ ...args(), signer, record, confirmation: challenge(network, config, artifact),
        save: async r => { records.push(JSON.parse(JSON.stringify(r))); } });
    } finally { await ethers.provider.send("evm_setIntervalMining", [0]); }
    expect(records[0].phase).to.equal("broadcast-intent");
    expect(records[0].deployTx).to.equal(record.deployTx);
    expect(record.phase).to.equal("deployed-readback");
    expect(record.readyForUse).to.equal(false);
    expect(record.sourceVerification).to.equal("pending");
    expect((await readback(ethers.provider, record)).runtimeHash).to.equal(record.runtimeHash);
    expect(JSON.stringify(records)).not.to.include(signer.privateKey);
    await expect(readback(ethers.provider, { ...record, deployTx: ethers.id("unknown") })).to.be.rejectedWith("receipt unavailable");
    await expect(readback(ethers.provider, { ...record, config: { ...config, treasury: admin.address } })).to.be.rejectedWith("readback failed");
  });
});
