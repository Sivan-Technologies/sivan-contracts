const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers } = require("ethers");
async function manifest() {
  const hre = require("hardhat");
  await hre.run("compile");
  const fqn = "contracts/SivanAgreementVault.sol:SivanAgreementVault";
  const artifact = await hre.artifacts.readArtifact(fqn), build = await hre.artifacts.getBuildInfo(fqn);
  const git = args => execFileSync("git",args,{encoding:"utf8"}).trim();
  return {schemaVersion:1,createdAt:new Date().toISOString(),commit:git(["rev-parse","HEAD"]),
    dirty:!!git(["status","--porcelain"]),compiler:build.solcVersion,settings:build.input.settings,
    compilerInputHash:ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(build.input))),
    lockfileHash:ethers.keccak256(fs.readFileSync(path.join(__dirname,"../package-lock.json"))),
    creationBytecodeHash:ethers.keccak256(artifact.bytecode),runtimeTemplateHash:ethers.keccak256(artifact.deployedBytecode),
    runtimeBytes:(artifact.deployedBytecode.length-2)/2,
    productionEnabled:false,
    gates:{unitTests:"pending evidence",fuzzInvariants:"pending evidence",staticAnalysis:"pending triage",
      dependencyReview:"pending approval",reproducibleBuild:"pending comparison",ci:"pending evidence",
      sourceVerification:"pending deployment",testnetIntegration:"pending evidence",independentAudit:"pending external review",
      adminAcceptance:"pending on-chain acceptance",multisigReview:"pending per-chain review",protectedSigner:"not integrated"}};
}
if (require.main === module) manifest().then(report=>{
  const dir=path.join(__dirname,"../release-evidence");fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,`manifest-${Date.now()}.json`);
  fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
  console.log("Draft evidence manifest:",file,"Production remains disabled.");
}).catch(()=>{console.error("Manifest generation failed; details withheld.");process.exitCode=1;});
module.exports = { manifest };
