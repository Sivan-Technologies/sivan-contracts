const { ethers } = require("ethers");
const { assertDeployable, DeploymentError } = require("../../config/evm-networks.cjs");
const ERC20 = ["function symbol() view returns(string)", "function decimals() view returns(uint8)"];
const { walletPolicy, checkControls } = require("./control-wallets");

function configuration(network, env) {
  if (env.EVM_PROFILE === "production") throw new DeploymentError("Production deployment remains disabled pending independent review and protected signer integration");
  assertDeployable(network);
  const read = suffix => {
    const value = (env[network.prefix + "_" + suffix] || "").trim();
    if (!value) throw new DeploymentError(`Configure ${network.prefix}_${suffix}`);
    return value;
  };
  const address = suffix => {
    const value = read(suffix);
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new DeploymentError(`Invalid ${suffix} address`);
    return ethers.getAddress(value);
  };
  const feeCollector = address("FEE_COLLECTOR"), agentAttester = address("AGENT_ATTESTER");
  if (feeCollector === agentAttester) throw new DeploymentError("Fee collector and attester must be separate");
  const agentId = read("AGENT_ID");
  if (!/^[1-9][0-9]*$/.test(agentId) || BigInt(agentId) >= 2n ** 256n) throw new DeploymentError("Invalid agent ID");
  const version = read("CONTRACT_VERSION");
  if (!/^v[1-9][0-9]*$/.test(version)) throw new DeploymentError("Contract version must be v1, v2, etc.");
  let tokens;
  try { tokens = JSON.parse(read("TOKENS_JSON")); } catch { throw new DeploymentError("Invalid TOKENS_JSON; expected explicit token metadata array"); }
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > 20) throw new DeploymentError("Configure 1 to 20 reviewed tokens");
  const seen = new Set();
  tokens = tokens.map(t => {
    if (!t || !ethers.isAddress(t.address || "") || t.address === ethers.ZeroAddress ||
        typeof t.symbol !== "string" || !t.symbol.length || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) {
      throw new DeploymentError("Invalid token address, symbol or decimals (supported range 0..18)");
    }
    const normalized = ethers.getAddress(t.address);
    if (seen.has(normalized)) throw new DeploymentError("Duplicate token address");
    seen.add(normalized);
    return { address: normalized, symbol: t.symbol, decimals: t.decimals };
  });
  const adminAddress = address("ADMIN_ADDRESS");
  if ([feeCollector,agentAttester].includes(adminAddress)) throw new DeploymentError("Admin must be separate from treasury and attester");
  const controlMode = read("CONTROL_MODE");
  if (!["testnet_eoa","multisig"].includes(controlMode)) throw new DeploymentError("CONTROL_MODE must be testnet_eoa or multisig");
  const treasuryPolicy = controlMode === "multisig" ? walletPolicy(read,"TREASURY") : undefined;
  const adminPolicy = controlMode === "multisig" ? walletPolicy(read,"ADMIN") : undefined;
  return { feeCollector, agentAttester, adminAddress, controlMode, treasuryPolicy, adminPolicy, agentId, version, tokens,
    attesterProofExpiry: env[network.prefix + "_ATTESTER_PROOF_EXPIRY"],
    attesterProof: env[network.prefix + "_ATTESTER_PROOF_SIGNATURE"] };
}

// Separate EIP-191 purpose: this proof cannot authorize a vault payout.
function attesterChallenge({ network, config, deployer, artifact }) {
  return JSON.stringify({ purpose: "Sivan deployment attester control proof v1",
    chainId: String(network.chainId), deployer: ethers.getAddress(deployer),
    version: config.version, feeCollector: ethers.getAddress(config.feeCollector),
    adminAddress: config.adminAddress || deployer, controlMode: config.controlMode || "testnet_eoa",
    treasuryPolicy: config.treasuryPolicy || null, adminPolicy: config.adminPolicy || null,
    agentAttester: ethers.getAddress(config.agentAttester), agentId: String(config.agentId),
    tokens: config.tokens.map(t => ({address: ethers.getAddress(t.address), symbol: t.symbol, decimals: t.decimals})),
    creationBytecodeHash: ethers.keccak256(artifact.bytecode), expiry: String(config.attesterProofExpiry) });
}

async function verifyAttesterProof(args) {
  const { config, provider } = args;
  const now = Number((await provider.getBlock("latest")).timestamp);
  const expiry = Number(config.attesterProofExpiry);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 86400) {
    throw new DeploymentError("Attester proof expiry must be in the next 24 hours");
  }
  // Delivered releases currently use ECDSA, not ERC-1271.
  if (await provider.getCode(config.agentAttester) !== "0x") throw new DeploymentError("Attester must be an ECDSA account without contract code");
  let recovered;
  try { recovered = ethers.verifyMessage(attesterChallenge(args), config.attesterProof); }
  catch { throw new DeploymentError("Invalid or missing attester control proof"); }
  if (recovered.toLowerCase() !== config.agentAttester.toLowerCase()) throw new DeploymentError("Attester control proof signer mismatch");
}

async function preflight({ network, config, provider, deployer, artifact, build }) {
  assertDeployable(network);
  // Check the actual RPC, not the locally configured network name.
  if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(network.chainId)) throw new DeploymentError("RPC chain ID mismatch");
  if (build.solcVersion !== "0.8.24" || build.input.settings.evmVersion !== network.evmVersion) throw new DeploymentError("Compiler/EVM target mismatch");
  if ((artifact.deployedBytecode.length - 2) / 2 > 24576) throw new DeploymentError("Runtime exceeds EVM size limit");
  if (new Set([deployer, config.feeCollector, config.agentAttester].map(a => a.toLowerCase())).size !== 3) {
    throw new DeploymentError("Deployer, collector and attester must be separate");
  }
  const block = await provider.getBlockNumber();
  for (const token of config.tokens) {
    if (await provider.getCode(token.address, block) === "0x") throw new DeploymentError("Configured token has no code");
    const contract = new ethers.Contract(token.address, ERC20, provider);
    if (await contract.symbol({ blockTag: block }) !== token.symbol || Number(await contract.decimals({ blockTag: block })) !== token.decimals) {
      throw new DeploymentError("Token metadata mismatch");
    }
  }
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const transaction = await factory.getDeployTransaction(config.feeCollector, config.agentAttester, config.agentId, deployer);
  const gas = await provider.estimateGas({ ...transaction, from: deployer });
  const fees = await provider.getFeeData();
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  if (!price || price <= 0n) throw new DeploymentError("Gas pricing unavailable");
  const balance = await provider.getBalance(deployer);
  // Conservative initial reserve; allowlist gas is checked again after creation.
  const reserve = (gas + 500000n) * price * 2n;
  if (balance < reserve) throw new DeploymentError("Insufficient native gas balance for deployment reserve");
  await verifyAttesterProof({ network, config, provider, deployer, artifact });
  const controls = await checkControls({config,provider,deployer});
  return { block, gas: gas.toString(), reserve: reserve.toString(), balance: balance.toString(), deployer, controls };
}

async function deployAndSeed({ network, config, signer, artifact, record, save }) {
  assertDeployable(network);
  const provider = signer.provider;
  if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(network.chainId)) throw new DeploymentError("RPC chain ID mismatch before send");
  if (record.phase !== "preflight") throw new DeploymentError("Do not restart a partial deployment; inspect the recorded address and transactions");
  await verifyAttesterProof({ network, config, provider, deployer: await signer.getAddress(), artifact });
  await checkControls({config,provider,deployer:await signer.getAddress()});
  // Persist intention first. An interrupted broadcast must never be blindly retried.
  record.phase = "deployment-broadcast-intent";
  record.nonce = await signer.getNonce("pending");
  record.vault = ethers.getCreateAddress({ from: await signer.getAddress(), nonce: record.nonce });
  save(record);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const vault = await factory.deploy(config.feeCollector, config.agentAttester, config.agentId, await signer.getAddress(), { nonce: record.nonce });
  record.deployTx = vault.deploymentTransaction().hash;
  save(record);
  const receipt = await vault.deploymentTransaction().wait();
  if (!receipt || receipt.status !== 1) throw new DeploymentError("Deployment receipt unsuccessful");
  record.deployBlock = receipt.blockNumber;
  record.phase = "deployed-unseeded";
  save(record);
  const needsHandover = config.adminAddress && config.adminAddress.toLowerCase() !== (await signer.getAddress()).toLowerCase();
  // Pause BEFORE allowlisting: never expose funding under the temporary admin.
  if (needsHandover) {
    record.phase = "admin-pause-intent"; save(record);
    const pause = await vault.pause();
    record.pauseTx = pause.hash; save(record); await pause.wait();
    if (!(await vault.paused())) throw new DeploymentError("Pause readback failed before seeding");
  }
  const addresses = config.tokens.map(t => t.address);
  const seedGas = await vault.setSupportedTokens.estimateGas(addresses, true);
  const fees = await provider.getFeeData();
  if (await provider.getBalance(await signer.getAddress()) < seedGas * (fees.maxFeePerGas ?? fees.gasPrice) * 2n) {
    throw new DeploymentError("Insufficient gas to seed existing vault; do not redeploy");
  }
  record.phase = "seed-broadcast-intent";
  save(record);
  const seed = await vault.setSupportedTokens(addresses, true);
  record.seedTx = seed.hash;
  save(record);
  const seeded = await seed.wait();
  if (!seeded || seeded.status !== 1) throw new DeploymentError("Seeding failed; do not redeploy");
  record.seedBlock = seeded.blockNumber;
  record.phase = "seeded-awaiting-readback";
  save(record);
  const overrides = { blockTag: seeded.blockNumber };
  if (!(await vault.tokenAllowlistEnforced(overrides))) throw new DeploymentError("Allowlist readback failed");
  for (const address of addresses) if (!(await vault.supportedTokens(address, overrides))) throw new DeploymentError("Token readback failed");
  if ((await vault.owner(overrides)).toLowerCase() !== (await signer.getAddress()).toLowerCase() ||
      (await vault.feeCollector(overrides)).toLowerCase() !== config.feeCollector.toLowerCase() ||
      (await vault.agentAttester(overrides)).toLowerCase() !== config.agentAttester.toLowerCase() ||
      String(await vault.registeredAgentId(overrides)) !== config.agentId) throw new DeploymentError("Role readback failed");
  record.runtimeHash = ethers.keccak256(await provider.getCode(record.vault, seeded.blockNumber));
  record.phase = "deployed-verified-readback";
  record.sourceVerification = "pending";
  save(record);
  if (needsHandover) {
    record.phase = "admin-handover-intent"; save(record);
    const handover = await vault.transferOwnership(config.adminAddress);
    record.handoverTx = handover.hash; save(record); await handover.wait();
    if (!(await vault.paused()) || (await vault.pendingOwner()).toLowerCase() !== config.adminAddress.toLowerCase()) throw new DeploymentError("Admin handover readback failed");
    record.phase = "awaiting-admin-acceptance"; save(record);
  }
  return vault;
}
module.exports = { configuration, preflight, deployAndSeed, attesterChallenge, verifyAttesterProof };
