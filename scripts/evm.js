const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers } = require("ethers");
const { networks, getNetwork, DeploymentError } = require("../config/evm-networks.cjs");
const { configuration, preflight, deployAndSeed, attesterChallenge } = require("./helpers/evm-deployment");

async function main() {
  require("./helpers/environment").loadEnvironment();
  const [action, name] = process.argv.slice(2);
  if (action === "list") {
    console.table(Object.values(networks).map(n => ({ network: n.name, chainId: n.chainId ?? "unverified", testnet: n.testnet, status: n.status })));
    return;
  }
  if (!["challenge", "preflight", "deploy"].includes(action)) throw new DeploymentError("Use list, challenge <network>, preflight <network> or deploy <network>");
  const network = getNetwork(name);
  const config = configuration(network, process.env);
  const prefix = network.prefix;
  const url = process.env[prefix + "_RPC_URL"];
  try { if (new URL(url).protocol !== "https:") throw new DeploymentError(); }
  catch { throw new DeploymentError("Configure an HTTPS RPC URL"); }
  const deployer = process.env[prefix + "_DEPLOYER_ADDRESS"];
  let wallet;
  if (action === "deploy") {
    if (process.env.EVM_DEPLOY_CONFIRM !== `${name}:${network.chainId}:${config.version}`) throw new DeploymentError("Exact deployment confirmation required");
    const key = (process.env[prefix + "_DEPLOYER_PRIVATE_KEY"] || "").trim();
    try { wallet = new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key); }
    catch { throw new DeploymentError("Invalid network-specific deployer key"); }
    if (!ethers.isAddress(deployer || "") || wallet.address.toLowerCase() !== deployer.toLowerCase()) throw new DeploymentError("Deployer key/address mismatch");
  }
  if (!ethers.isAddress(deployer || "") || deployer === ethers.ZeroAddress) throw new DeploymentError("Configure network-specific DEPLOYER_ADDRESS; preflight needs no key");
  const hre = require("hardhat");
  await hre.run("compile");
  const fqn = "contracts/SivanAgreementVault.sol:SivanAgreementVault";
  const artifact = await hre.artifacts.readArtifact(fqn);
  const build = await hre.artifacts.getBuildInfo(fqn);
  if (action === "challenge") {
    const expiry = Number(config.attesterProofExpiry), now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 86400) throw new DeploymentError("Set ATTESTER_PROOF_EXPIRY to a Unix timestamp in the next 24 hours");
    console.log(attesterChallenge({ network, config, deployer, artifact }));
    return;
  }
  const request = new ethers.FetchRequest(url);
  request.timeout = 15000;
  const provider = new ethers.JsonRpcProvider(request);
  try {
    const checks = await preflight({ network, config, provider, deployer, artifact, build });
    console.log(JSON.stringify({ network: name, chainId: network.chainId, version: config.version, checks, note: "Read-only checks; not production certification" }, null, 2));
    if (action !== "deploy") return;
    const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
    if (git(["status", "--porcelain"])) throw new DeploymentError("Commit and review changes before remote deployment");
    const commit = git(["rev-parse", "HEAD"]);
    const dir = path.join(__dirname, "..", "deployments");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${network.chainId}-${config.version}.json`);
    const record = { network: name, chainId: network.chainId, version: config.version, commit,
      abi: artifact.abi, compiler: build.solcVersion, compilerSettings: build.input.settings,
      creationBytecodeHash: ethers.keccak256(artifact.bytecode), config, checks, phase: "preflight", createdAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
    const save = data => {
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    };
    console.log("Deployment journal:", file);
    await deployAndSeed({ network, config, signer: wallet.connect(provider), artifact, record, save });
    console.log(JSON.stringify({phase:record.phase,readyForUse:false,sourceVerification:record.sourceVerification}));
    if (record.phase === "awaiting-admin-acceptance") console.log("Vault remains paused. The intended admin must independently accept ownership; activation requires release approval.");
    console.log("Source verification and end-to-end integration remain pending. Deployment readback is not production clearance.");
  } finally { provider.destroy(); }
}
main().catch(error => {
  // RPC exceptions can embed credential-bearing URLs or signed transactions.
  if (error instanceof DeploymentError) console.error(error.message);
  console.error("EVM operation stopped. Check configuration and any deployment journal; do not blindly retry a deployment. Error details withheld to protect credentials.");
  process.exitCode = 1;
});
