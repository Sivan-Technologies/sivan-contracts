const { ethers } = require("ethers");
const { DeploymentError } = require("../../config/evm-networks.cjs");
const ABI = ["function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)",
  "function masterCopy() view returns(address)", "function getModulesPaginated(address,uint256) view returns(address[],address)"];
const SENTINEL = "0x0000000000000000000000000000000000000001";
function walletPolicy(read, role) {
  let owners;
  try { owners = JSON.parse(read(role + "_OWNERS_JSON")); } catch { throw new DeploymentError("Invalid multisig owner list"); }
  if (!Array.isArray(owners) || owners.length !== 3 || owners.some(a => !ethers.isAddress(a) || a === ethers.ZeroAddress)) throw new DeploymentError("Configure exactly three nonzero multisig owners");
  owners = owners.map(ethers.getAddress);
  if (new Set(owners).size !== 3) throw new DeploymentError("Multisig owners must be distinct");
  const codeHash = read(role + "_CODE_HASH"), implementationCodeHash = read(role + "_IMPLEMENTATION_CODE_HASH");
  if (![codeHash,implementationCodeHash].every(h => ethers.isHexString(h,32) && h !== ethers.ZeroHash)) throw new DeploymentError("Reviewed multisig code hashes required");
  const fallbackCodeHash = read(role + "_FALLBACK_CODE_HASH");
  if (!ethers.isHexString(fallbackCodeHash,32)) throw new DeploymentError("Reviewed fallback handler hash required; zero hash means no handler");
  return { owners, codeHash, implementationCodeHash, fallbackCodeHash };
}
async function checkWallet(provider, address, policy, forbidden, blockTag) {
  if (!policy || policy.owners.some(a => forbidden.some(f => f.toLowerCase() === a.toLowerCase()))) throw new DeploymentError("Multisig owner conflicts with deployer or automated attester");
  const code = await provider.getCode(address,blockTag);
  if (code === "0x" || ethers.keccak256(code) !== policy.codeHash) throw new DeploymentError("Multisig proxy code hash mismatch");
  const wallet = new ethers.Contract(address,ABI,provider), overrides={blockTag};
  const implementation = await wallet.masterCopy(overrides);
  const implementationCode=await provider.getCode(implementation,blockTag);
  if (implementationCode === "0x" || ethers.keccak256(implementationCode) !== policy.implementationCodeHash) throw new DeploymentError("Multisig implementation code hash mismatch");
  const owners = (await wallet.getOwners(overrides)).map(a=>a.toLowerCase()).sort();
  if (await wallet.getThreshold(overrides) !== 2n || owners.length !== 3 ||
      JSON.stringify(owners) !== JSON.stringify(policy.owners.map(a=>a.toLowerCase()).sort())) throw new DeploymentError("Expected reviewed 2-of-3 multisig configuration");
  const [modules,next] = await wallet.getModulesPaginated(SENTINEL,1,overrides);
  if (modules.length || next !== SENTINEL) throw new DeploymentError("Enabled multisig modules require separate review; refusing baseline deployment");
  // Storage layout must be confirmed against the separately reviewed Safe version.
  const guard = await provider.getStorage(address,ethers.id("guard_manager.guard.address"),blockTag);
  if (BigInt(guard) !== 0n) throw new DeploymentError("Enabled multisig guard requires separate review");
  const fallback = await provider.getStorage(address,ethers.id("fallback_manager.handler.address"),blockTag);
  const handler = ethers.getAddress("0x"+fallback.slice(-40));
  if (handler === ethers.ZeroAddress) {
    if (policy.fallbackCodeHash !== ethers.ZeroHash) throw new DeploymentError("Fallback handler mismatch");
  } else {
    const handlerCode = await provider.getCode(handler,blockTag);
    if (handlerCode === "0x" || ethers.keccak256(handlerCode) !== policy.fallbackCodeHash) throw new DeploymentError("Fallback handler code hash mismatch");
  }
  return {address,implementation,owners,threshold:2,block:blockTag};
}
async function checkControls({config,provider,deployer}) {
  if (config.controlMode !== "multisig") return {mode:"testnet_eoa",productionReady:false};
  const addresses = [deployer,config.adminAddress,config.feeCollector,config.agentAttester];
  if (addresses.some(a=>!ethers.isAddress(a || "")) || new Set(addresses.map(a=>a.toLowerCase())).size !== 4) throw new DeploymentError("Deployer, admin, treasury and attester must be separate");
  const block = await provider.getBlockNumber();
  return {mode:"multisig",block,
    treasury:await checkWallet(provider,config.feeCollector,config.treasuryPolicy,[deployer,config.agentAttester],block),
    admin:await checkWallet(provider,config.adminAddress,config.adminPolicy,[deployer,config.agentAttester],block)};
}
module.exports = { walletPolicy, checkControls, checkWallet };
