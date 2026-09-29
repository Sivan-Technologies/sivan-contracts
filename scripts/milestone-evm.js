const fs=require("fs");
const path=require("path");
const {execFileSync}=require("child_process");
const {ethers}=require("ethers");
const {getNetwork,DeploymentError}=require("../config/evm-networks.cjs");
const {configuration,challenge,preflight,deploy,constructorArgs,FQN}=require("./helpers/milestone-deployment");

function requireConfirmation(network,config,env) {
  if(env.MILESTONE_DEPLOY_CONFIRM!==`milestone:${network.name}:${network.chainId}:${config.version}`)
    throw new DeploymentError("Exact milestone deployment confirmation required");
}
async function main() {
  require("./helpers/environment").loadEnvironment();
  const [action,name]=process.argv.slice(2);
  if(!["challenge","preflight","deploy"].includes(action)) throw new DeploymentError("Use challenge/preflight/deploy <network>");
  const network=getNetwork(name),config=configuration(network,process.env),prefix=network.prefix;
  const deployer=process.env[`${prefix}_MILESTONE_DEPLOYER_ADDRESS`];
  if(!ethers.isAddress(deployer || "") || deployer===ethers.ZeroAddress) throw new DeploymentError("Configure milestone deployer address");
  const hre=require("hardhat");await hre.run("compile");
  const artifact=await hre.artifacts.readArtifact(FQN),build=await hre.artifacts.getBuildInfo(FQN);
  if(action==="challenge") {console.log(challenge({network,config,deployer,artifact}));return;}
  const url=process.env[`${prefix}_RPC_URL`];
  try {if(new URL(url).protocol!=="https:") throw new Error();}catch {throw new DeploymentError("Configure HTTPS milestone network RPC");}
  const request=new ethers.FetchRequest(url);request.timeout=15000;
  const provider=new ethers.JsonRpcProvider(request);
  try {
    const checks=await preflight({network,config,provider,deployer,artifact,build});
    console.log(JSON.stringify({network:name,chainId:network.chainId,checks,readyForUse:false},null,2));
    if(action!=="deploy") return;
    requireConfirmation(network,config,process.env);
    const git=args=>execFileSync("git",args,{encoding:"utf8"}).trim();
    if(git(["status","--porcelain"])) throw new DeploymentError("Commit and review changes before milestone deployment");
    let signer;
    try {signer=new ethers.Wallet(process.env[`${prefix}_MILESTONE_DEPLOYER_PRIVATE_KEY`],provider);}
    catch {throw new DeploymentError("Configure dedicated testnet milestone signing key");}
    if(signer.address.toLowerCase()!==deployer.toLowerCase()) throw new DeploymentError("Milestone deployer key/address mismatch");
    const dir=path.resolve(__dirname,"../deployments");fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,`milestone-${network.chainId}-${config.version}.json`);
    const record={kind:"milestone",network:name,chainId:network.chainId,version:config.version,commit:git(["rev-parse","HEAD"]),
      config,constructorArguments:constructorArgs(config),abi:artifact.abi,compiler:build.solcVersion,compilerSettings:build.input.settings,
      compilerInputHash:ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(build.input))),
      lockfileHash:ethers.keccak256(fs.readFileSync(path.resolve(__dirname,"../package-lock.json"))),
      creationBytecodeHash:ethers.keccak256(artifact.bytecode),checks,phase:"preflight",readyForUse:false,createdAt:new Date().toISOString()};
    // Exclusive creation prevents overwriting partial runs or single-vault records.
    fs.writeFileSync(file,JSON.stringify(record,null,2),{flag:"wx",mode:0o600});
    const save=r=>{fs.writeFileSync(file+".tmp",JSON.stringify(r,null,2),{mode:0o600});fs.renameSync(file+".tmp",file);};
    await deploy({network,config,signer,artifact,build,record,save});
    console.log(JSON.stringify({vault:record.vault,phase:record.phase,sourceVerification:record.sourceVerification,readyForUse:false,journal:file}));
    console.log("Immutable roles; no pause or handover. Source verification, independent review and application integration remain pending.");
  } finally {provider.destroy();}
}
if(require.main===module) main().catch(error=>{
  if(error instanceof DeploymentError) console.error(error.message);
  console.error("Milestone operation stopped. Inspect the journal before retrying. Provider/secret details withheld.");process.exitCode=1;
});
module.exports={requireConfirmation};
