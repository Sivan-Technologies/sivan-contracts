const hre = require("hardhat");
const { ethers } = require("ethers");
async function main() {
  const fingerprints = [];
  for (let i=0;i<2;i++) {
    await hre.run("compile",{force:true});
    const contracts = {};
    for (const name of ["SivanAgreementVault", "SivanClaimVault"]) {
      const artifact = await hre.artifacts.readArtifact(name);
      contracts[name] = {creation:ethers.keccak256(artifact.bytecode),
        runtime:ethers.keccak256(artifact.deployedBytecode),abi:artifact.abi};
    }
    fingerprints.push(JSON.stringify(contracts));
  }
  if (fingerprints[0] !== fingerprints[1]) throw new Error("Repeated compilation produced different artifacts");
  for (const [name, artifact] of Object.entries(JSON.parse(fingerprints[0])))
    console.log("Two forced local builds match:", name, artifact.creation);
}
main().catch(()=>{console.error("Reproducible build check failed.");process.exitCode=1;});
