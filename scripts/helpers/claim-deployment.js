const { ethers } = require("ethers");
const { assertDeployable, DeploymentError } = require("../../config/evm-networks.cjs");
const { walletPolicy, checkWallet } = require("./control-wallets");

const FQN = "contracts/SivanClaimVault.sol:SivanClaimVault";
const ACK = "bearer-key-seven-day-net-refund-nonrefundable-fee";
function guard(network, profile) {
  if (profile !== "testnet") throw new DeploymentError("Claim deployment requires the testnet profile");
  assertDeployable(network);
}
function configuration(network, env) {
  guard(network, env.EVM_PROFILE);
  const read = key => {
    const value = (env[`${network.prefix}_CLAIM_${key}`] || "").trim();
    if (!value) throw new DeploymentError(`Configure ${network.prefix}_CLAIM_${key}`);
    return value;
  };
  const address = value => {
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new DeploymentError("Invalid claim role/token address");
    return ethers.getAddress(value);
  };
  const admin = address(read("ADMIN")), treasury = address(read("TREASURY")), deployer = address(read("DEPLOYER_ADDRESS"));
  if (new Set([admin, treasury, deployer]).size !== 3) throw new DeploymentError("Separate claim admin, treasury and deployer required");
  const version = read("VERSION");
  if (!/^v[1-9][0-9]*$/.test(version)) throw new DeploymentError("Invalid claim deployment version");
  if (read("RISK_ACK") !== ACK) throw new DeploymentError("Claim risk acknowledgement required");
  const controlMode = read("CONTROL_MODE");
  if (!["testnet_eoa", "multisig"].includes(controlMode)) throw new DeploymentError("Invalid claim control mode");
  let tokens;
  try { tokens = JSON.parse(read("TOKENS_JSON")); } catch { throw new DeploymentError("Invalid claim token JSON"); }
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > 20) throw new DeploymentError("Configure 1..20 claim tokens");
  tokens = tokens.map(t => {
    if (!t || typeof t.symbol !== "string" || !/^[A-Za-z0-9._-]{1,32}$/.test(t.symbol) ||
        !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18 ||
        !ethers.isHexString(t.codeHash, 32) || t.codeHash === ethers.ZeroHash)
      throw new DeploymentError("Claim tokens require reviewed symbol, decimals and runtime code hash");
    return { address: address(t.address), symbol: t.symbol, decimals: t.decimals, codeHash: t.codeHash.toLowerCase() };
  });
  if (new Set(tokens.map(t => t.address)).size !== tokens.length) throw new DeploymentError("Duplicate claim token");
  if (tokens.some(t => [admin, treasury, deployer].includes(t.address))) throw new DeploymentError("Claim token/role conflict");
  return { profile: "testnet", admin, treasury, deployer, version, controlMode, tokens, riskAck: ACK,
    adminPolicy: controlMode === "multisig" ? walletPolicy(read, "ADMIN") : null,
    treasuryPolicy: controlMode === "multisig" ? walletPolicy(read, "TREASURY") : null };
}
function constructorArgs(config) { return [config.admin, config.treasury, config.tokens.map(t => t.address)]; }
function challenge(network, config, artifact) {
  return ethers.id(JSON.stringify({ purpose: "Sivan claim testnet deployment v1", chainId: network.chainId,
    config, creationBytecodeHash: ethers.keccak256(artifact.bytecode) }));
}
function requireConfirmation(network, config, artifact, value) {
  if (value !== challenge(network, config, artifact)) throw new DeploymentError("Exact CLAIM_DEPLOY_CONFIRM challenge required");
}
async function preflight({ network, config, provider, artifact, build }) {
  guard(network, config.profile);
  if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(network.chainId)) throw new DeploymentError("Claim RPC chain mismatch");
  if (artifact.contractName !== "SivanClaimVault" || artifact.sourceName !== "contracts/SivanClaimVault.sol" ||
      build.solcVersion !== "0.8.24" || build.input.settings.evmVersion !== "cancun") throw new DeploymentError("Claim artifact/compiler mismatch");
  if ((artifact.deployedBytecode.length - 2) / 2 > 24576) throw new DeploymentError("Claim runtime exceeds size limit");
  const block = await provider.getBlockNumber();
  if (await provider.getCode(config.deployer, block) !== "0x") throw new DeploymentError("Claim deployer must be a dedicated test EOA");
  let controls;
  if (config.controlMode === "multisig") {
    controls = {
      admin: await checkWallet(provider, config.admin, config.adminPolicy, [config.deployer, config.treasury], block),
      treasury: await checkWallet(provider, config.treasury, config.treasuryPolicy, [config.deployer, config.admin], block)
    };
  } else {
    for (const role of [config.admin, config.treasury]) if (await provider.getCode(role, block) !== "0x")
      throw new DeploymentError("Contract control wallets require reviewed multisig mode");
    controls = { mode: "testnet_eoa", productionReady: false };
  }
  for (const token of config.tokens) {
    const code = await provider.getCode(token.address, block);
    if (code === "0x" || ethers.keccak256(code) !== token.codeHash) throw new DeploymentError("Claim token runtime mismatch");
    const contract = new ethers.Contract(token.address, ["function symbol() view returns(string)", "function decimals() view returns(uint8)"], provider);
    if (await contract.symbol({ blockTag: block }) !== token.symbol || Number(await contract.decimals({ blockTag: block })) !== token.decimals)
      throw new DeploymentError("Claim token metadata mismatch");
  }
  const tx = await new ethers.ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...constructorArgs(config));
  const gas = await provider.estimateGas({ ...tx, from: config.deployer });
  const fees = await provider.getFeeData(), price = fees.maxFeePerGas ?? fees.gasPrice;
  if (!price || price <= 0n) throw new DeploymentError("Claim gas price unavailable");
  const reserve = gas * price * 2n;
  if (await provider.getBalance(config.deployer) < reserve) throw new DeploymentError("Insufficient claim deployment gas reserve");
  return { block, gas: String(gas), reserve: String(reserve), controls };
}
async function readback(provider, record) {
  const receipt = await provider.getTransactionReceipt(record.deployTx);
  if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== record.vault.toLowerCase())
    throw new DeploymentError("Claim deployment receipt unavailable or invalid; reconcile before retrying");
  const vault = new ethers.Contract(record.vault, record.abi, provider), options = { blockTag: receipt.blockNumber };
  if (await vault.owner(options) !== record.config.admin || await vault.treasury(options) !== record.config.treasury ||
      await vault.pendingOwner(options) !== ethers.ZeroAddress || await vault.fundingPaused(options) ||
      await vault.FEE_BPS(options) !== 50n || await vault.CLAIM_WINDOW(options) !== 604800n)
    throw new DeploymentError("Claim deployment role/policy readback failed");
  for (const token of record.config.tokens) if (!await vault.allowedTokens(token.address, options)) throw new DeploymentError("Claim allowlist readback failed");
  const code = await provider.getCode(record.vault, receipt.blockNumber);
  if (code === "0x") throw new DeploymentError("Claim deployed code missing");
  return { deployBlock: receipt.blockNumber, deployBlockHash: receipt.blockHash, runtimeHash: ethers.keccak256(code) };
}
async function deploy({ network, config, signer, artifact, build, record, save, confirmation }) {
  requireConfirmation(network, config, artifact, confirmation);
  if (record.phase !== "preflight") throw new DeploymentError("Inspect partial claim deployment; do not retry blindly");
  if (await signer.getAddress() !== config.deployer) throw new DeploymentError("Claim deployer key/address mismatch");
  record.checks = await preflight({ network, config, provider: signer.provider, artifact, build });
  const nonce = await signer.getNonce("pending");
  record.vault = ethers.getCreateAddress({ from: config.deployer, nonce });
  if ([config.admin, config.treasury, ...config.tokens.map(t => t.address)].includes(record.vault)) throw new DeploymentError("Predicted claim vault conflicts with role/token");
  const request = await new ethers.ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...constructorArgs(config));
  const transaction = await signer.populateTransaction({ ...request, nonce, chainId: network.chainId });
  const signed = await signer.signTransaction(transaction);
  // Persist identity before broadcast; never persist the raw signed transaction/key.
  record.nonce = nonce; record.deployTx = ethers.keccak256(signed); record.phase = "broadcast-intent";
  await save(record);
  const response = await signer.provider.broadcastTransaction(signed);
  await response.wait(2, 180000);
  Object.assign(record, await readback(signer.provider, record), { phase: "deployed-readback", sourceVerification: "pending", readyForUse: false });
  await save(record);
}
module.exports = { FQN, ACK, guard, configuration, constructorArgs, challenge, requireConfirmation, preflight, readback, deploy };
