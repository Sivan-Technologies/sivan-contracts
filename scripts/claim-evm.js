const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers } = require("ethers");
const { getNetwork, networks, DeploymentError } = require("../config/evm-networks.cjs");
const { FQN, configuration, constructorArgs, challenge, requireConfirmation, preflight, readback, deploy } = require("./helpers/claim-deployment");

async function main() {
  require("./helpers/environment").loadEnvironment();
  const [action, name] = process.argv.slice(2);
  if (action === "list") {
    console.table(Object.values(networks).map(n => ({ network: n.name, chainId: n.chainId,
      claimDeployment: !n.testnet ? "mainnet blocked" : n.status === "candidate" ? "testnet candidate" : "compatibility review pending",
      environmentPrefix: `${n.prefix}_CLAIM` })));
    return;
  }
  if (!["challenge", "preflight", "deploy", "recover", "verify"].includes(action)) throw new DeploymentError("Use challenge/preflight/deploy/recover/verify <network>");
  const network = getNetwork(name), config = configuration(network, process.env);
  // Hardhat explorer verification must target the same selected chain, never its default local network.
  if (action === "verify") {
    for (const key of ["EXPLORER_API_URL", "EXPLORER_BROWSER_URL"]) {
      try { if (new URL(process.env[`${network.prefix}_${key}`]).protocol !== "https:") throw new Error(); }
      catch { throw new DeploymentError("Configure HTTPS claim explorer endpoints"); }
    }
    if (!process.env[`${network.prefix}_EXPLORER_API_KEY`]) throw new DeploymentError("Configure claim explorer API key");
    process.env.HARDHAT_NETWORK = name;
  }
  const hre = require("hardhat");
  await hre.run("compile");
  const artifact = await hre.artifacts.readArtifact(FQN), build = await hre.artifacts.getBuildInfo(FQN);
  if (action === "challenge") { console.log(challenge(network, config, artifact)); return; }
  const url = process.env[`${network.prefix}_RPC_URL`];
  try { if (new URL(url).protocol !== "https:") throw new Error(); } catch { throw new DeploymentError("Configure HTTPS claim testnet RPC"); }
  const request = new ethers.FetchRequest(url); request.timeout = 15000;
  const provider = new ethers.JsonRpcProvider(request);
  const dir = path.resolve(__dirname, "../deployments"), file = path.join(dir, `claim-${network.chainId}-${config.version}.json`);
  const save = record => {
    fs.writeFileSync(file + ".tmp", JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  };
  try {
    if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(network.chainId)) throw new DeploymentError("Claim RPC chain mismatch");
    if (["recover", "verify"].includes(action)) {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.kind !== "claim" || record.chainId !== network.chainId || record.challenge !== challenge(network, config, artifact) ||
          JSON.stringify(record.config) !== JSON.stringify(config) || JSON.stringify(record.abi) !== JSON.stringify(artifact.abi) ||
          JSON.stringify(record.constructorArguments) !== JSON.stringify(constructorArgs(config)))
        throw new DeploymentError("Claim journal/config/build mismatch; restore the original reviewed configuration");
      const checks = await readback(provider, record);
      if (record.runtimeHash && checks.runtimeHash !== record.runtimeHash) throw new DeploymentError("Claim runtime hash changed");
      Object.assign(record, checks, { phase: "deployed-readback", readyForUse: false });
      if (action === "verify") {
        await hre.run("verify:verify", { address: record.vault, constructorArguments: record.constructorArguments, contract: FQN });
        record.sourceVerification = "verified";
      }
      save(record);
      console.log(JSON.stringify({ journal: file, vault: record.vault, sourceVerification: record.sourceVerification, readyForUse: false }));
      return;
    }
    const checks = await preflight({ network, config, provider, artifact, build });
    console.log(JSON.stringify({ network: name, checks, readyForUse: false }, null, 2));
    if (action === "preflight") return;
    requireConfirmation(network, config, artifact, process.env.CLAIM_DEPLOY_CONFIRM);
    const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
    if (git(["status", "--porcelain"])) throw new DeploymentError("Commit and review changes before claim deployment");
    let signer;
    try { signer = new ethers.Wallet(process.env[`${network.prefix}_CLAIM_DEPLOYER_PRIVATE_KEY`], provider); }
    catch { throw new DeploymentError("Configure a dedicated claim TESTNET deployer key"); }
    if (signer.address !== config.deployer) throw new DeploymentError("Claim deployer key/address mismatch");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const record = { kind: "claim", network: name, chainId: network.chainId, config, abi: artifact.abi,
      constructorArguments: constructorArgs(config), challenge: challenge(network, config, artifact),
      commit: git(["rev-parse", "HEAD"]), compiler: build.solcVersion, compilerSettings: build.input.settings,
      compilerInputHash: ethers.id(JSON.stringify(build.input)), lockfileHash: ethers.keccak256(fs.readFileSync(path.resolve(__dirname, "../package-lock.json"))),
      creationBytecodeHash: ethers.keccak256(artifact.bytecode), phase: "preflight", sourceVerification: "pending", readyForUse: false,
      createdAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
    await deploy({ network, config, signer, artifact, build, record, save, confirmation: process.env.CLAIM_DEPLOY_CONFIRM });
    console.log(JSON.stringify({ journal: file, vault: record.vault, sourceVerification: "pending", readyForUse: false }));
  } finally { provider.destroy(); }
}
if (require.main === module) main().catch(error => {
  if (error instanceof DeploymentError) console.error(error.message);
  console.error("Claim operation stopped. Inspect the journal before retrying. Provider and secret details withheld.");
  process.exitCode = 1;
});
module.exports = { main };
