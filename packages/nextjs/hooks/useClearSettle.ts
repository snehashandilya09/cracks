import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";

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
  phase: "ACCEPTING_COMMITS" | "ACCEPTING_REVEALS" | "SETTLING" | "IN_TRANSITION" | "SAFETY_BUFFER" | "FINALIZED" | "VOID";
  phaseNumber: number;
  blocksRemaining: number;
  percentComplete: number;
}

const PHASE_NAMES: { [key: number]: CurrentPhaseInfo["phase"] } = {
  0: "ACCEPTING_COMMITS",
  1: "ACCEPTING_REVEALS",
  2: "SETTLING",
  3: "IN_TRANSITION",
  4: "SAFETY_BUFFER",
  5: "FINALIZED",
  6: "VOID",
};

export function useClearSettle() {
  const [currentBlock, setCurrentBlock] = useState<bigint>(100n);
  const [epochData, setEpochData] = useState<EpochData | null>(null);
  const [currentPhase, setCurrentPhase] = useState<CurrentPhaseInfo | null>(null);
  const publicClient = usePublicClient();
  const [demoTime, setDemoTime] = useState<number>(0); // For phase simulation

  // Simulated time progression - advances phases for demo
  useEffect(() => {
    const interval = setInterval(() => {
      setDemoTime((prev) => prev + 1);
      // Progress 1 "block" every 5 seconds for demo
      setCurrentBlock((prev) => prev + 1n);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Create dynamic epoch data based on current block
  const createEpochData = (block: bigint): EpochData => {
    const startBlock = 100n;
    const commitEndBlock = 110n;
    const revealEndBlock = 120n;
    const settleBlock = 130n;
    const safetyEndBlock = 140n;

    return {
      epochId: 1n,
      phase: 0,
      startBlock,
      commitEndBlock,
      revealEndBlock,
      settleBlock,
      safetyEndBlock,
      clearingPrice: block > settleBlock ? BigInt(Math.floor(2500 * 1e18)) : 0n,
      totalBuyVolume: BigInt(Math.floor(10.5 * 1e18)),
      totalSellVolume: BigInt(Math.floor(9.8 * 1e18)),
      matchedVolume: BigInt(Math.floor(9.8 * 1e18)),
      disputed: false,
    };
  };

  const mockEpochData = createEpochData(currentBlock);

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
    const interval = setInterval(updateBlockNumber, 12000); // Update every block (~12s)

    return () => clearInterval(interval);
  }, [publicClient]);

  // Update epoch data and calculate phase
  useEffect(() => {
    const data = mockEpochData;
    setEpochData(data);

    // Calculate current phase
    if (currentBlock > 0n) {
      let phase: CurrentPhaseInfo["phase"] = "VOID";
      let phaseNumber = 6;
      let endBlock = data.startBlock;

      if (currentBlock < data.commitEndBlock) {
        phase = "ACCEPTING_COMMITS";
        phaseNumber = 0;
        endBlock = data.commitEndBlock;
      } else if (currentBlock < data.revealEndBlock) {
        phase = "ACCEPTING_REVEALS";
        phaseNumber = 1;
        endBlock = data.revealEndBlock;
      } else if (currentBlock < data.settleBlock) {
        phase = "SETTLING";
        phaseNumber = 2;
        endBlock = data.settleBlock;
      } else if (currentBlock < data.safetyEndBlock) {
        phase = "SAFETY_BUFFER";
        phaseNumber = 4;
        endBlock = data.safetyEndBlock;
      } else {
        phase = "FINALIZED";
        phaseNumber = 5;
        endBlock = data.safetyEndBlock;
      }

      const blocksRemaining = Number(endBlock - currentBlock);
      const totalBlocks = Number(endBlock - data.startBlock);
      const percentComplete = Math.max(0, Math.min(100, ((totalBlocks - blocksRemaining) / totalBlocks) * 100));

      setCurrentPhase({
        phase,
        phaseNumber,
        blocksRemaining: Math.max(0, blocksRemaining),
        percentComplete,
      });
    }
  }, [currentBlock]);

  const refetchEpoch = () => {
    // In a real implementation, this would refetch from the contract
    // For demo purposes, it's a no-op
  };

  return {
    currentBlock,
    epochData,
    currentPhase,
    refetchEpoch,
  };
}
