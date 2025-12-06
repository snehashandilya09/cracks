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
  error?: string; // Error message if failed
}

export interface AggregatedPrice {
  price: number;
  confidence: number;
  deviation: number;
  activeSources: number;
  totalSources: number;
  healthy: boolean;
  aggregationMethod: "median" | "majority" | "single"; // How price was calculated
  warning?: string;
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

  // Fetch oracle data from blockchain
  useEffect(() => {
    const fetchOracleData = async () => {
      if (!publicClient || !ORACLE_ADDRESS || !ORACLE_ABI) {
        setLoading(false);
        setError("Oracle contract not deployed on this network");
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

        // Build ALL oracle data (including failed ones)
        const oracleData: OracleSource[] = [];

        // Chainlink
        const chainlinkPriceNum = Number(chainlinkPrice) / 1e18;
        oracleData.push({
          name: "Chainlink",
          price: chainlinkSuccess ? chainlinkPriceNum : 0,
          updateTime: chainlinkSuccess ? "Recent" : "N/A",
          staleness: 0,
          healthy: chainlinkSuccess && chainlinkPriceNum > 0,
          confidence: chainlinkSuccess ? 98 : 0,
          error: chainlinkSuccess ? undefined : "Failed to fetch from Chainlink feed",
        });

        // Pyth
        const pythPriceNum = Number(pythPrice) / 1e18;
        oracleData.push({
          name: "Pyth Network",
          price: pythSuccess ? pythPriceNum : 0,
          updateTime: pythSuccess ? "May be stale (testnet)" : "N/A",
          staleness: 0,
          healthy: pythSuccess && pythPriceNum > 0,
          confidence: pythSuccess ? 95 : 0,
          error: pythSuccess ? undefined : "Pyth price unavailable (testnet may not have updates)",
        });

        // Uniswap
        const uniswapPriceNum = Number(uniswapPrice) / 1e18;
        const uniswapSane = uniswapPriceNum > 100 && uniswapPriceNum < 10000;
        oracleData.push({
          name: "Uniswap V3 TWAP",
          price: uniswapSuccess ? uniswapPriceNum : 0,
          updateTime: uniswapSuccess ? "Real-time TWAP" : "N/A",
          staleness: 0,
          healthy: uniswapSuccess && uniswapSane,
          confidence: uniswapSuccess && uniswapSane ? 96 : 30,
          error: uniswapSuccess
            ? !uniswapSane
              ? "Price abnormal (testnet pool may lack liquidity)"
              : undefined
            : "Failed to fetch TWAP (pool may not have observations)",
        });

        setOracles(oracleData);

        // Calculate aggregated price with smart fallback
        const validPrices = oracleData.filter(o => o.healthy && o.price > 100 && o.price < 100000).map(o => o.price);

        if (validPrices.length === 0) {
          // No valid prices - try any remotely reasonable price
          const anyPrice = oracleData.find(o => o.price > 100 && o.price < 100000);
          if (anyPrice) {
            setAggregatedPrice({
              price: anyPrice.price,
              confidence: 20,
              deviation: 0,
              activeSources: 1,
              totalSources: 3,
              healthy: false,
              aggregationMethod: "single",
              warning: `Only ${anyPrice.name} available - low confidence`,
            });
          } else {
            setAggregatedPrice({
              price: 0,
              confidence: 0,
              deviation: 0,
              activeSources: 0,
              totalSources: 3,
              healthy: false,
              aggregationMethod: "single",
              warning: "No valid oracle prices available",
            });
          }
        } else if (validPrices.length === 1) {
          const source = oracleData.find(o => o.healthy && o.price > 100)!;
          setAggregatedPrice({
            price: validPrices[0],
            confidence: 40,
            deviation: 0,
            activeSources: 1,
            totalSources: 3,
            healthy: false,
            aggregationMethod: "single",
            warning: `Only ${source.name} available`,
          });
        } else {
          // Multiple valid prices - calculate deviation and decide method
          const sortedPrices = [...validPrices].sort((a, b) => a - b);
          const minPrice = sortedPrices[0];
          const maxPrice = sortedPrices[sortedPrices.length - 1];
          const medianPrice =
            sortedPrices.length % 2 === 0
              ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
              : sortedPrices[Math.floor(sortedPrices.length / 2)];

          const deviation = ((maxPrice - minPrice) / medianPrice) * 100;

          let finalPrice: number;
          let aggregationMethod: "median" | "majority";
          let confidence: number;
          let warning: string | undefined;

          if (deviation > 30) {
            // High deviation - use majority voting (find the two closest prices)
            let bestPair = [validPrices[0], validPrices[1]];
            let minDiff = Math.abs(validPrices[0] - validPrices[1]);

            for (let i = 0; i < validPrices.length; i++) {
              for (let j = i + 1; j < validPrices.length; j++) {
                const diff = Math.abs(validPrices[i] - validPrices[j]);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestPair = [validPrices[i], validPrices[j]];
                }
              }
            }

            finalPrice = (bestPair[0] + bestPair[1]) / 2;
            aggregationMethod = "majority";
            confidence = Math.max(30, 70 - deviation);
            warning = `High deviation (${deviation.toFixed(1)}%) - using majority voting`;
          } else {
            // Normal deviation - use median
            finalPrice = medianPrice;
            aggregationMethod = "median";
            confidence = Math.min(99, 100 - deviation * 2);
            warning = undefined;
          }

          setAggregatedPrice({
            price: finalPrice,
            confidence: Math.round(confidence),
            deviation: deviation,
            activeSources: validPrices.length,
            totalSources: 3,
            healthy: deviation < 30 && validPrices.length >= 2,
            aggregationMethod,
            warning,
          });
        }

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
