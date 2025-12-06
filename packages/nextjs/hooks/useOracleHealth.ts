import { useEffect, useState } from "react";
import { type Abi, getContract, keccak256, toBytes } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

export interface OracleSource {
  name: string;
  price: number;
  updateTime: string;
  staleness: number;
  healthy: boolean;
  confidence: number;
}

export interface AggregatedPrice {
  price: number;
  confidence: number;
  deviation: number;
  activeSources: number;
  healthy: boolean;
}

export function useOracleHealth() {
  const chainId = useChainId();
  const publicClient = usePublicClient();

  const ORACLE_CONTRACT = (deployedContracts as any)[chainId]?.OracleAggregator;
  const ORACLE_ADDRESS = ORACLE_CONTRACT?.address as `0x${string}`;
  const ORACLE_ABI = ORACLE_CONTRACT?.abi as Abi;

  const [oracles, setOracles] = useState<OracleSource[]>([]);
  const [aggregatedPrice, setAggregatedPrice] = useState<AggregatedPrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to format timestamp to "X minutes ago"
  const formatTimeAgo = (timestamp: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const secondsAgo = now - timestamp;

    if (secondsAgo < 60) return `${secondsAgo} seconds ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)} minutes ago`;
    if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)} hours ago`;
    return `${Math.floor(secondsAgo / 86400)} days ago`;
  };

  // Fetch oracle data from blockchain
  useEffect(() => {
    const fetchOracleData = async () => {
      if (!publicClient || !ORACLE_ADDRESS || !ORACLE_ABI) {
        setLoading(false);
        return;
      }

      try {
        setError(null);

        const contract = getContract({
          address: ORACLE_ADDRESS,
          abi: ORACLE_ABI,
          client: publicClient,
        });

        // ETH/USD pair ID
        const ethUsdPairId = keccak256(toBytes("ETH/USD"));

        // Fetch aggregated price data
        const aggData = await contract.read.getAggregatedPrice([ethUsdPairId]);

        // Fetch individual oracle prices
        const individualPrices = (await contract.read.getIndividualPrices([ethUsdPairId])) as [
          bigint,
          bigint,
          bigint,
          boolean,
          boolean,
          boolean,
        ];
        const [chainlinkPrice, pythPrice, uniswapPrice, chainlinkSuccess, pythSuccess, uniswapSuccess] =
          individualPrices;

        // Get current timestamp
        const now = Math.floor(Date.now() / 1000);

        // Parse aggregated data
        const aggPriceData = aggData as any;
        const priceInEth = Number(aggPriceData.price) / 1e18; // Convert from wei (18 decimals)
        const confidence = Number(aggPriceData.confidence);
        const deviation = Number(aggPriceData.deviation) / 100; // Convert from basis points
        const timestamp = Number(aggPriceData.timestamp);
        const staleness = now - timestamp;

        // Build individual oracle data
        const oracleData: OracleSource[] = [];

        if (chainlinkSuccess) {
          oracleData.push({
            name: "Chainlink",
            price: Number(chainlinkPrice) / 1e18,
            updateTime: formatTimeAgo(timestamp),
            staleness: staleness,
            healthy: true,
            confidence: 98, // Chainlink typically has high confidence
          });
        }

        if (pythSuccess) {
          oracleData.push({
            name: "Pyth Network",
            price: Number(pythPrice) / 1e18,
            updateTime: formatTimeAgo(timestamp),
            staleness: staleness,
            healthy: true,
            confidence: 99, // Pyth has very fast updates
          });
        }

        if (uniswapSuccess) {
          oracleData.push({
            name: "Uniswap V3 TWAP",
            price: Number(uniswapPrice) / 1e18,
            updateTime: "Real-time",
            staleness: 0, // TWAP is computed on-chain
            healthy: true,
            confidence: 96,
          });
        }

        setOracles(oracleData);
        setAggregatedPrice({
          price: priceInEth,
          confidence: confidence,
          deviation: deviation,
          activeSources: oracleData.length,
          healthy: aggPriceData.isHealthy,
        });

        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch oracle data:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    };

    fetchOracleData();

    // Refresh every 15 seconds
    const interval = setInterval(fetchOracleData, 15000);

    return () => clearInterval(interval);
  }, [publicClient, ORACLE_ADDRESS, ORACLE_ABI]);

  return {
    oracles,
    aggregatedPrice,
    loading,
    error,
  };
}
