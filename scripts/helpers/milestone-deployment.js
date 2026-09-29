const { ethers } = require("ethers");
const { assertDeployable, DeploymentError } = require("../../config/evm-networks.cjs");
const { walletPolicy, checkWallet } = require("./control-wallets");
const ACK = "funding-pause-bilateral-reviewer-recovery";
const FQN = "contracts/SivanMilestoneVault.sol:SivanMilestoneVault";

function configuration(network, env) {
  if (env.EVM_PROFILE === "production") throw new DeploymentError("Milestone production deployment disabled");
  assertDeployable(network);
  const read = key => {
    const value = (env[`${network.prefix}_MILESTONE_${key}`] || "").trim();
    if (!value) throw new DeploymentError(`Configure ${network.prefix}_MILESTONE_${key}`);
    return value;
  };
  const addr = value => {
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) throw new DeploymentError("Invalid milestone role address");
    return ethers.getAddress(value);
  };
  const feeCollector = addr((env[`${network.prefix}_MILESTONE_FEE_COLLECTOR`] || "").trim() ||
    (env[`${network.prefix}_FEE_COLLECTOR`] || "").trim() || (env.SIVAN_FEE_COLLECTOR || "").trim());
  const primaryReviewer = addr(read("PRIMARY_REVIEWER"));
  const fundingAdmin = addr(read("FUNDING_ADMIN"));
  if (new Set([feeCollector,primaryReviewer,fundingAdmin]).size !== 3) throw new DeploymentError("Milestone control roles must be separate");
  if (feeCollector === primaryReviewer) throw new DeploymentError("Treasury and reviewer must be separate");
  const rate = read("FEE_BPS");
  if (!/^(0|[1-9][0-9]*)$/.test(rate) || Number(rate) > 300) throw new DeploymentError("Fee must be 0..300 integer bps");
  const version = read("VERSION");
  if (!/^v[1-9][0-9]*$/.test(version)) throw new DeploymentError("Invalid milestone release version");
  if (read("RISK_ACK") !== ACK) throw new DeploymentError("Explicit immutable milestone risk acknowledgement required");
  const controlMode = read("CONTROL_MODE");
  if (!["testnet_eoa", "multisig"].includes(controlMode)) throw new DeploymentError("Invalid milestone control mode");
  let tokens;
  try { tokens = JSON.parse(read("TOKENS_JSON")); } catch { throw new DeploymentError("Invalid milestone token metadata"); }
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > 20) throw new DeploymentError("Configure 1..20 milestone tokens");
  const seen = new Set();
  tokens = tokens.map(t => {
    if (!t || !ethers.isAddress(t.address || "") || t.address === ethers.ZeroAddress || typeof t.symbol !== "string" ||
        !t.symbol || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) throw new DeploymentError("Invalid milestone token metadata");
    const address = ethers.getAddress(t.address);
    if (seen.has(address)) throw new DeploymentError("Duplicate milestone token");
    seen.add(address); return {address, symbol:t.symbol, decimals:t.decimals};
  });
  return {feeCollector, primaryReviewer, fundingAdmin, adminPolicy:walletPolicy(read,"ADMIN"), feeBps:Number(rate), version, riskAck:ACK, controlMode, tokens,
    treasuryPolicy:controlMode === "multisig" ? walletPolicy(read,"TREASURY") : null,
    reviewerPolicy:controlMode === "multisig" ? walletPolicy(read,"REVIEWER") : null,
    proofExpiry:read("REVIEWER_PROOF_EXPIRY"), proof:env[`${network.prefix}_MILESTONE_REVIEWER_PROOF_SIGNATURE`]};
}
function challenge({network,config,deployer,artifact}) {
  return JSON.stringify({purpose:"Sivan milestone deployment reviewer consent v1",chainId:String(network.chainId),
    deployer:ethers.getAddress(deployer), version:config.version,feeCollector:config.feeCollector,
    primaryReviewer:config.primaryReviewer,fundingAdmin:config.fundingAdmin,adminPolicy:config.adminPolicy,feeBps:config.feeBps,tokens:config.tokens,controlMode:config.controlMode,
    treasuryPolicy:config.treasuryPolicy,reviewerPolicy:config.reviewerPolicy,riskAck:config.riskAck,
    creationBytecodeHash:ethers.keccak256(artifact.bytecode),expiry:String(config.proofExpiry)});
}
async function verifyProof(args) {
  const {provider,config}=args;
  const now=Number((await provider.getBlock("latest")).timestamp), expiry=Number(config.proofExpiry);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now+86400) throw new DeploymentError("Reviewer proof must expire within 24 hours");
  const message=challenge(args),code=await provider.getCode(config.primaryReviewer);
  let valid=false;
  try {
    if(code === "0x") valid=ethers.verifyMessage(message,config.proof).toLowerCase()===config.primaryReviewer.toLowerCase();
    else valid=await new ethers.Contract(config.primaryReviewer,["function isValidSignature(bytes32,bytes) view returns (bytes4)"],provider)
      .isValidSignature(ethers.hashMessage(message),config.proof)==="0x1626ba7e";
  } catch { /* Provider/signature details must not leak credentials. */ }
  if(!valid) throw new DeploymentError("Reviewer control proof invalid or unavailable");
}
async function preflight({network,config,provider,deployer,artifact,build}) {
  assertDeployable(network);
  if(BigInt(await provider.send("eth_chainId",[]))!==BigInt(network.chainId)) throw new DeploymentError("Milestone RPC chain mismatch");
  if(artifact.contractName!=="SivanMilestoneVault" || artifact.sourceName!=="contracts/SivanMilestoneVault.sol") throw new DeploymentError("Wrong milestone artifact");
  if(build.solcVersion!=="0.8.24" || build.input.settings.evmVersion!==network.evmVersion) throw new DeploymentError("Milestone compiler target mismatch");
  if((artifact.deployedBytecode.length-2)/2>24576) throw new DeploymentError("Milestone runtime exceeds size limit");
  if(!ethers.isAddress(deployer) || deployer===ethers.ZeroAddress || new Set([deployer,config.feeCollector,config.primaryReviewer,config.fundingAdmin].map(a=>a.toLowerCase())).size!==4)
    throw new DeploymentError("Milestone deployer, treasury and reviewer must be separate");
  const block=await provider.getBlockNumber();
  const fundingAdmin=await checkWallet(provider,config.fundingAdmin,config.adminPolicy,[deployer,config.feeCollector,config.primaryReviewer],block);
  for(const t of config.tokens) {
    if(await provider.getCode(t.address,block)==="0x") throw new DeploymentError("Milestone token has no code");
    const token=new ethers.Contract(t.address,["function symbol() view returns(string)","function decimals() view returns(uint8)"],provider);
    if(await token.symbol({blockTag:block})!==t.symbol || Number(await token.decimals({blockTag:block}))!==t.decimals) throw new DeploymentError("Milestone token metadata mismatch");
  }
  let controls={mode:"testnet_eoa",productionReady:false};
  if(config.controlMode==="multisig") controls={mode:"multisig",
    treasury:await checkWallet(provider,config.feeCollector,config.treasuryPolicy,[deployer],block),
    reviewer:await checkWallet(provider,config.primaryReviewer,config.reviewerPolicy,[deployer],block)};
  else if(await provider.getCode(config.feeCollector,block)!=="0x" || await provider.getCode(config.primaryReviewer,block)!=="0x")
    throw new DeploymentError("Contract control wallets require multisig policy review");
  await verifyProof({network,config,provider,deployer,artifact});
  const tx=await new ethers.ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...constructorArgs(config));
  const gas=await provider.estimateGas({...tx,from:deployer}),fees=await provider.getFeeData();
  const price=fees.maxFeePerGas ?? fees.gasPrice;
  if(!price || price<=0n) throw new DeploymentError("Milestone gas pricing unavailable");
  const reserve=gas*price*2n;
  if(await provider.getBalance(deployer)<reserve) throw new DeploymentError("Insufficient milestone deployment gas reserve");
  return {block,gas:String(gas),reserve:String(reserve),controls,fundingAdmin};
}
function constructorArgs(c) {return [c.feeCollector,c.primaryReviewer,c.feeBps,c.tokens.map(t=>t.address),c.fundingAdmin];}
async function deploy({network,config,signer,artifact,build,record,save}) {
  if(record.phase!=="preflight") throw new DeploymentError("Inspect partial milestone deployment; do not retry blindly");
  const provider=signer.provider,deployer=await signer.getAddress();
  record.checks=await preflight({network,config,provider,deployer,artifact,build});
  record.phase="deployment-broadcast-intent";
  record.nonce=await signer.getNonce("pending");
  record.vault=ethers.getCreateAddress({from:deployer,nonce:record.nonce});
  if([config.feeCollector,config.primaryReviewer,config.fundingAdmin,...config.tokens.map(t=>t.address)].some(a=>a.toLowerCase()===record.vault.toLowerCase())) throw new DeploymentError("Predicted vault role/token conflict");
  await save(record);
  const vault=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...constructorArgs(config),{nonce:record.nonce});
  record.deployTx=vault.deploymentTransaction().hash; await save(record);
  const receipt=await vault.deploymentTransaction().wait();
  if(!receipt || receipt.status!==1) throw new DeploymentError("Milestone deployment receipt failed");
  record.deployBlock=receipt.blockNumber;record.phase="deployed-awaiting-readback";await save(record);
  const options={blockTag:receipt.blockNumber};
  if(await vault.getAddress()!==record.vault || await vault.feeCollector(options)!==ethers.getAddress(config.feeCollector) ||
    await vault.primaryReviewer(options)!==ethers.getAddress(config.primaryReviewer) || await vault.fundingAdmin(options)!==ethers.getAddress(config.fundingAdmin) ||
    await vault.fundingPaused(options) || await vault.feeBps(options)!==BigInt(config.feeBps)) throw new DeploymentError("Milestone role readback failed");
  for(const t of config.tokens) if(!await vault.supportedToken(t.address,options)) throw new DeploymentError("Milestone allowlist readback failed");
  record.runtimeHash=ethers.keccak256(await provider.getCode(record.vault,receipt.blockNumber));
  record.phase="deployed-verified-readback";record.sourceVerification="pending";record.readyForUse=false;
  await save(record);return vault;
}
module.exports={configuration,challenge,verifyProof,preflight,deploy,constructorArgs,FQN,ACK};
