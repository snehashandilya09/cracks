import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Oracle System Deployment Script
 * ================================
 *
 * Deploys the Byzantine-fault-tolerant oracle aggregation system
 *
 * DEPLOYMENT ORDER:
 * 1. ChainlinkOracleAdapter - Connects to Chainlink price feeds
 * 2. PythOracleAdapter - Connects to Pyth Network
 * 3. UniswapV3TWAPAdapter - On-chain TWAP from Uniswap V3
 * 4. OracleAggregator - Aggregates all 3 sources (median calculation)
 *
 * NETWORK: Sepolia Testnet
 *
 * @param hre HardhatRuntimeEnvironment object
 */
const deployOracles: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║           ORACLE AGGREGATION SYSTEM DEPLOYMENT                 ║");
  console.log("║     Byzantine-Fault-Tolerant Price Oracle Infrastructure       ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log("\n");
  console.log("📋 Deployer:", deployer);
  console.log("🌐 Network:", hre.network.name);
  console.log("\n");

  // Step 1: Deploy ChainlinkOracleAdapter
  console.log("🚀 [1/4] Deploying ChainlinkOracleAdapter...");
  const chainlinkAdapter = await deploy("ChainlinkOracleAdapter", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
  console.log("✅ ChainlinkOracleAdapter deployed at:", chainlinkAdapter.address);

  // Step 2: Deploy PythOracleAdapter
  console.log("\n🚀 [2/4] Deploying PythOracleAdapter...");
  const pythAdapter = await deploy("PythOracleAdapter", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
  console.log("✅ PythOracleAdapter deployed at:", pythAdapter.address);

  // Step 3: Deploy UniswapV3TWAPAdapter
  console.log("\n🚀 [3/4] Deploying UniswapV3TWAPAdapter...");
  const uniswapAdapter = await deploy("UniswapV3TWAPAdapter", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });
  console.log("✅ UniswapV3TWAPAdapter deployed at:", uniswapAdapter.address);

  // Step 4: Deploy OracleAggregator (connects all 3 adapters)
  console.log("\n🚀 [4/4] Deploying OracleAggregator...");
  const oracleAggregator = await deploy("OracleAggregator", {
    from: deployer,
    args: [chainlinkAdapter.address, pythAdapter.address, uniswapAdapter.address],
    log: true,
    autoMine: true,
  });
  console.log("✅ OracleAggregator deployed at:", oracleAggregator.address);

  // Log deployment summary
  console.log("\n");
  console.log("📊 Oracle System Deployment Summary:");
  console.log("═══════════════════════════════════════════════");
  console.log("  Chainlink Adapter:  ", chainlinkAdapter.address);
  console.log("  Pyth Adapter:       ", pythAdapter.address);
  console.log("  Uniswap V3 Adapter: ", uniswapAdapter.address);
  console.log("  Oracle Aggregator:  ", oracleAggregator.address);
  console.log("\n");

  // Verify oracle feeds are registered
  console.log("🔍 Verifying oracle configuration...");

  const chainlinkContract = await hre.ethers.getContract<Contract>("ChainlinkOracleAdapter", deployer);
  const pythContract = await hre.ethers.getContract<Contract>("PythOracleAdapter", deployer);

  const ethUsdPairId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ETH/USD"));

  const chainlinkRegistered = await chainlinkContract.isFeedRegistered(ethUsdPairId);
  const pythRegistered = await pythContract.isFeedRegistered(ethUsdPairId);

  console.log("  Chainlink ETH/USD Feed:", chainlinkRegistered ? "✅ Registered" : "❌ Not Found");
  console.log("  Pyth ETH/USD Feed:     ", pythRegistered ? "✅ Registered" : "❌ Not Found");

  console.log("\n");
  console.log("✨ Oracle system deployment complete!");
  console.log("\n");
  console.log("📝 NEXT STEPS:");
  console.log("  1. Update deployedContracts.ts with oracle addresses");
  console.log("  2. Create useOracleHealth hook in frontend");
  console.log("  3. Update oracle dashboard to use real data");
  console.log("\n");
};

export default deployOracles;

// Tags for selective deployment
deployOracles.tags = ["Oracles", "OracleAggregator"];

// Run after main ClearSettle deployment
deployOracles.dependencies = [];
