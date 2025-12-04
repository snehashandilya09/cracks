import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * ClearSettle Protocol Deployment Script
 * ======================================
 * 
 * Deploys the ClearSettle Epoch-Based Batch Auction Protocol
 * 
 * DEPLOYMENT CHECKLIST:
 * - [ ] ClearSettle main contract
 * - [ ] Verify constructor initializes first epoch
 * - [ ] Log initial configuration
 * 
 * NETWORK-SPECIFIC NOTES:
 * - localhost: Uses auto-mining, instant blocks
 * - testnet: Real block times, need to adjust epoch durations
 * - mainnet: TODO - increase safety buffer to 64 blocks
 * 
 * @param hre HardhatRuntimeEnvironment object
 */
const deployClearSettle: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║           CLEARSETTLE PROTOCOL DEPLOYMENT                      ║");
  console.log("║     Epoch-Based Batch Auction Settlement Protocol              ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log("\n");
  console.log("📋 Deployer:", deployer);
  console.log("🌐 Network:", hre.network.name);
  console.log("\n");

  // Deploy ClearSettle main contract
  console.log("🚀 Deploying ClearSettle...");
  
  const clearSettleDeployment = await deploy("ClearSettle", {
    from: deployer,
    args: [], // No constructor arguments
    log: true,
    autoMine: true,
  });

  console.log("✅ ClearSettle deployed at:", clearSettleDeployment.address);

  // Get deployed contract instance
  const clearSettle = await hre.ethers.getContract<Contract>("ClearSettle", deployer);

  // Log initial state
  console.log("\n");
  console.log("📊 Initial Protocol State:");
  console.log("───────────────────────────────────────────────");
  
  const currentEpoch = await clearSettle.getCurrentEpoch();
  console.log("  Current Epoch:", currentEpoch.toString());
  
  const currentPhase = await clearSettle.getCurrentPhase();
  const phaseNames = [
    "UNINITIALIZED",
    "ACCEPTING_COMMITS",
    "ACCEPTING_REVEALS", 
    "SETTLING",
    "SAFETY_BUFFER",
    "FINALIZED",
    "VOID"
  ];
  console.log("  Current Phase:", phaseNames[Number(currentPhase)]);
  
  const config = await clearSettle.getConfig();
  console.log("  Commit Duration:", config.commitDuration.toString(), "blocks");
  console.log("  Reveal Duration:", config.revealDuration.toString(), "blocks");
  console.log("  Safety Buffer:", config.safetyBufferDuration.toString(), "blocks");
  console.log("  Min Bond:", hre.ethers.formatEther(config.minCommitBond), "ETH");
  
  const epochData = await clearSettle.getEpochData(currentEpoch);
  console.log("  Epoch Start Block:", epochData.startBlock.toString());
  console.log("  Commit End Block:", epochData.commitEndBlock.toString());
  console.log("  Reveal End Block:", epochData.revealEndBlock.toString());
  
  console.log("\n");
  console.log("✨ Deployment complete!");
  console.log("\n");
  console.log("📝 NEXT STEPS:");
  console.log("  1. Start the frontend: yarn start");
  console.log("  2. Connect wallet and commit an order");
  console.log("  3. Wait for reveal phase and reveal");
  console.log("  4. Trigger settlement");
  console.log("  5. Wait for safety buffer");
  console.log("  6. Claim your settlement");
  console.log("\n");
};

export default deployClearSettle;

// Tags for selective deployment
deployClearSettle.tags = ["ClearSettle"];
