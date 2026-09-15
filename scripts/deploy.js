const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SivanAgreementVault with account:", deployer.address);

  // Defaults:
  const feeCollector = process.env.SIVAN_FEE_COLLECTOR || deployer.address;
  const agentAttester = process.env.SIVAN_AGENT_ATTESTER || deployer.address;
  const registeredAgentId = 9827; // ERC-8004 Agent ID on Celo Mainnet

  console.log("Parameters:");
  console.log(" - Fee Collector:", feeCollector);
  console.log(" - Agent Attester (ERC-8004 #9827):", agentAttester);
  console.log(" - Registered Agent ID:", registeredAgentId);

  const SivanAgreementVault = await hre.ethers.getContractFactory("SivanAgreementVault");
  const vault = await SivanAgreementVault.deploy(
    feeCollector,
    agentAttester,
    registeredAgentId,
    deployer.address
  );

  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log("\nSivanAgreementVault deployed successfully to:", vaultAddress);
  console.log("Network:", hre.network.name, "(Chain ID:", hre.network.config.chainId, ")");

  return vaultAddress;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
