const hre = require("hardhat");
const { ethers } = require("ethers");
async function main() {
  const fingerprints = [];
  for (let i=0;i<2;i++) {
    await hre.run("compile",{force:true});
    const artifact = await hre.artifacts.readArtifact("SivanAgreementVault");
    fingerprints.push(JSON.stringify({creation:ethers.keccak256(artifact.bytecode),
      runtime:ethers.keccak256(artifact.deployedBytecode),abi:artifact.abi}));
  }
  if (fingerprints[0] !== fingerprints[1]) throw new Error("Repeated compilation produced different artifacts");
  console.log("Two forced local builds match:",JSON.parse(fingerprints[0]).creation);
}
main().catch(()=>{console.error("Reproducible build check failed.");process.exitCode=1;});
