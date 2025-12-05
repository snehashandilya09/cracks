import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { getContract, type Abi } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

// Get deployed contract info
const chainId = 31337; // localhost
const CLEARSETTLE_CONTRACT = deployedContracts[chainId]?.ClearSettle;
const CLEAR_SETTLE_ADDRESS = CLEARSETTLE_CONTRACT?.address as `0x${string}`;

export interface EpochData {
  epochId: bigint;
  phase: number;
  startBlock: bigint;
  commitEndBlock: bigint;
  revealEndBlock: bigint;
  settleBlock: bigint;
  safetyEndBlock: bigint;
  clearingPrice: bigint;
  totalBuyVolume: bigint;
  totalSellVolume: bigint;
  matchedVolume: bigint;
  disputed: boolean;
}

export interface CurrentPhaseInfo {
  phase: "UNINITIALIZED" | "ACCEPTING_COMMITS" | "ACCEPTING_REVEALS" | "SETTLING" | "IN_TRANSITION" | "SAFETY_BUFFER" | "FINALIZED" | "VOID";
  phaseNumber: number;
  blocksRemaining: number;
  percentComplete: number;
}

// Must match contract enum exactly:
// enum EpochPhase { UNINITIALIZED=0, ACCEPTING_COMMITS=1, ACCEPTING_REVEALS=2, 
//                   SETTLING=3, IN_TRANSITION=4, SAFETY_BUFFER=5, FINALIZED=6, VOID=7 }
const PHASE_NAMES: { [key: number]: CurrentPhaseInfo["phase"] } = {
  0: "UNINITIALIZED",
  1: "ACCEPTING_COMMITS",
  2: "ACCEPTING_REVEALS",
  3: "SETTLING",
  4: "IN_TRANSITION",
  5: "SAFETY_BUFFER",
  6: "FINALIZED",
  7: "VOID",
};

// Use complete ABI from deployed contract
const CLEAR_SETTLE_ABI = CLEARSETTLE_CONTRACT?.abi as Abi;

export function useClearSettle() {
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [epochData, setEpochData] = useState<EpochData | null>(null);
  const [currentPhase, setCurrentPhase] = useState<CurrentPhaseInfo | null>(null);
  const publicClient = usePublicClient();

  // Fetch current block number periodically
  useEffect(() => {
    const updateBlockNumber = async () => {
      if (!publicClient) return;
      try {
        const block = await publicClient.getBlockNumber();
        setCurrentBlock(block);
      } catch (e) {
        console.error("Failed to fetch block:", e);
      }
    };

    updateBlockNumber();
    const interval = setInterval(updateBlockNumber, 12000); // Update every ~12s

    return () => clearInterval(interval);
  }, [publicClient]);

  // Fetch epoch data from contract
  useEffect(() => {
    const fetchEpochData = async () => {
      if (!publicClient) return;

      try {
        const contract = getContract({
          address: CLEAR_SETTLE_ADDRESS,
          abi: CLEAR_SETTLE_ABI,
          client: publicClient,
        });

        // Get current epoch ID
        const epochId = await contract.read.getCurrentEpochId();

        // Get epoch data - this returns a tuple which viem converts to an object
        const data = await contract.read.getEpochData([epochId]);

        // Extract values from the returned object/tuple
        const epochDataObj = data as any;

        setEpochData({
          epochId: BigInt(epochDataObj.epochId || 0),
          phase: Number(epochDataObj.phase || 0),
          startBlock: BigInt(epochDataObj.startBlock || 0),
          commitEndBlock: BigInt(epochDataObj.commitEndBlock || 0),
          revealEndBlock: BigInt(epochDataObj.revealEndBlock || 0),
          settleBlock: BigInt(epochDataObj.settleBlock || 0),
          safetyEndBlock: BigInt(epochDataObj.safetyEndBlock || 0),
          clearingPrice: BigInt(epochDataObj.clearingPrice || 0),
          totalBuyVolume: BigInt(epochDataObj.totalBuyVolume || 0),
          totalSellVolume: BigInt(epochDataObj.totalSellVolume || 0),
          matchedVolume: BigInt(epochDataObj.matchedVolume || 0),
          disputed: Boolean(epochDataObj.disputed || false),
        });

        // Get current phase
        const phaseNum = await contract.read.getCalculatedPhase();
        const blocksRemaining = await contract.read.getBlocksRemaining();

        const phase: CurrentPhaseInfo["phase"] = PHASE_NAMES[Number(phaseNum)] || "VOID";
        const safetyEndBlock = BigInt(epochDataObj.safetyEndBlock || 0);
        const startBlock = BigInt(epochDataObj.startBlock || 0);
        const totalBlocks = safetyEndBlock - startBlock;
        const blocksUsed = currentBlock - startBlock;
        const percentComplete = totalBlocks > 0n ? Math.min(100, Number((blocksUsed * 100n) / totalBlocks)) : 0;

        setCurrentPhase({
          phase,
          phaseNumber: Number(phaseNum),
          blocksRemaining: Number(blocksRemaining),
          percentComplete,
        });
      } catch (e) {
        console.error("Failed to fetch epoch data:", e);
      }
    };

    fetchEpochData();
    const interval = setInterval(fetchEpochData, 5000); // Update every 5s

    return () => clearInterval(interval);
  }, [publicClient, currentBlock]);

  const refetchEpoch = async () => {
    // Trigger re-fetch by updating current block
    if (!publicClient) return;
    const block = await publicClient.getBlockNumber();
    setCurrentBlock(block);
  };

  return {
    currentBlock,
    epochData,
    currentPhase,
    refetchEpoch,
  };
}
