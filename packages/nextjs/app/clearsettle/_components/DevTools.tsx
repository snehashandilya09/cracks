"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useChainId, usePublicClient, useWaitForTransactionReceipt, useWalletClient, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

type HexAddress = `0x${string}`;

export function DevTools() {
  const chainId = useChainId();
  const isLocalhost = chainId === 31337;

  const [blocksToMine, setBlocksToMine] = useState("10");
  const [isMining, setIsMining] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);
  const [phaseEndBlock, setPhaseEndBlock] = useState<bigint>(0n);
  const [phaseName, setPhaseName] = useState<string>("UNKNOWN");

  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContract, data: txHash } = useWriteContract();

  const CONTRACT = deployedContracts[chainId as keyof typeof deployedContracts]?.ClearSettle;

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (txConfirmed && txHash) {
      toast.success("Transaction confirmed!");
      setTimeout(() => window.location.reload(), 1000);
    }
  }, [txConfirmed, txHash]);

  useEffect(() => {
    const fetchBlockInfo = async () => {
      if (!publicClient || !CONTRACT) return;
      try {
        const block = await publicClient.getBlockNumber();
        setCurrentBlock(block);

        const contractAddress = CONTRACT.address as HexAddress;

        const epochId = (await publicClient.readContract({
          address: contractAddress,
          abi: CONTRACT.abi,
          functionName: "getCurrentEpochId",
        })) as bigint;

        const epochData = (await publicClient.readContract({
          address: contractAddress,
          abi: CONTRACT.abi,
          functionName: "getEpochData",
          args: [epochId],
        })) as any;

        // Use getCalculatedPhase for correct phase (not stored phase which may be stale)
        const calculatedPhase = (await publicClient.readContract({
          address: contractAddress,
          abi: CONTRACT.abi,
          functionName: "getCalculatedPhase",
        })) as number;

        const PHASE_NAMES = [
          "UNINITIALIZED",
          "ACCEPTING_COMMITS",
          "ACCEPTING_REVEALS",
          "SETTLING",
          "IN_TRANSITION",
          "SAFETY_BUFFER",
          "FINALIZED",
          "VOID",
        ];
        setPhaseName(PHASE_NAMES[calculatedPhase] || "UNKNOWN");

        if (calculatedPhase === 1) setPhaseEndBlock(epochData.commitEndBlock);
        else if (calculatedPhase === 2) setPhaseEndBlock(epochData.revealEndBlock);
        else if (calculatedPhase === 5) setPhaseEndBlock(epochData.safetyEndBlock);
        else setPhaseEndBlock(0n);
      } catch (e) {
        console.error("Error fetching block info:", e);
      }
    };

    fetchBlockInfo();
    const interval = setInterval(fetchBlockInfo, 3000);
    return () => clearInterval(interval);
  }, [publicClient, CONTRACT]);

  const blocksRemaining = phaseEndBlock > currentBlock ? Number(phaseEndBlock - currentBlock) : 0;
  const estimatedSeconds = isLocalhost ? blocksRemaining : blocksRemaining * 12;

  const mineBlocks = async (count: number) => {
    if (!isLocalhost) {
      toast.error("Mining only works on localhost!");
      return;
    }
    if (!walletClient) {
      toast.error("Wallet not connected");
      return;
    }
    setIsMining(true);
    try {
      const hexCount = "0x" + count.toString(16);
      await walletClient.request({
        method: "hardhat_mine" as any,
        params: [hexCount],
      });
      toast.success("Mined " + count + " blocks!");
      const newBlock = await publicClient?.getBlockNumber();
      if (newBlock) setCurrentBlock(newBlock);
    } catch (e: any) {
      toast.error("Mining failed: " + e.message);
    } finally {
      setIsMining(false);
    }
  };

  const resetToCommitPhase = async () => {
    if (!CONTRACT) return toast.error("Contract not found");
    const contractAddress = CONTRACT.address as HexAddress;
    setIsMining(true);
    try {
      toast("Resetting epoch...", { icon: "🔄" });
      writeContract({
        address: contractAddress,
        abi: CONTRACT.abi,
        functionName: "resetForDemo",
      });
    } catch (e: any) {
      toast.error("Failed: " + e.message);
      setIsMining(false);
    }
  };

  const settleEpoch = async () => {
    if (!CONTRACT) return toast.error("Contract not found");
    const contractAddress = CONTRACT.address as HexAddress;
    setIsMining(true);
    try {
      toast("Settling epoch...", { icon: "⚙️" });
      writeContract({
        address: contractAddress,
        abi: CONTRACT.abi,
        functionName: "settleEpoch",
      });
    } catch (e: any) {
      toast.error("Failed: " + e.message);
      setIsMining(false);
    }
  };

  const claimSettlement = async () => {
    if (!CONTRACT || !publicClient) return toast.error("Contract not found");
    const contractAddress = CONTRACT.address as HexAddress;
    setIsMining(true);
    try {
      const epochId = await publicClient.readContract({
        address: contractAddress,
        abi: CONTRACT.abi,
        functionName: "getCurrentEpochId",
      });
      toast("Claiming settlement...", { icon: "💰" });
      writeContract({
        address: contractAddress,
        abi: CONTRACT.abi,
        functionName: "claimSettlement",
        args: [epochId],
      });
    } catch (e: any) {
      toast.error("Failed: " + e.message);
      setIsMining(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return "~" + seconds + "s";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return "~" + mins + "m " + secs + "s";
  };

  const containerClass = isLocalhost
    ? "rounded-lg border-2 p-4 border-amber-300 bg-amber-50"
    : "rounded-lg border-2 p-4 border-blue-300 bg-blue-50";

  const titleClass = isLocalhost ? "font-bold text-amber-900" : "font-bold text-blue-900";
  const badgeClass = isLocalhost
    ? "rounded px-2 py-1 text-xs bg-amber-200 text-amber-800"
    : "rounded px-2 py-1 text-xs bg-blue-200 text-blue-800";

  return (
    <div className={containerClass}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{isLocalhost ? "🛠️" : "🌐"}</span>
          <h3 className={titleClass}>{isLocalhost ? "Dev Tools (Localhost)" : "Protocol Controls (Testnet)"}</h3>
        </div>
        <span className={badgeClass}>Chain: {chainId}</span>
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-white/60 p-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500">Current Phase:</span>
            <p className="font-bold text-slate-900">{phaseName}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Current Block:</span>
            <p className="font-mono font-bold text-slate-900">{currentBlock.toString()}</p>
          </div>
          {blocksRemaining > 0 && (
            <div className="text-right">
              <span className="text-xs text-slate-500">Next Phase In:</span>
              <p className="font-bold text-emerald-600">
                {blocksRemaining} blocks ({formatTime(estimatedSeconds)})
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          onClick={settleEpoch}
          disabled={isMining}
          className="rounded bg-yellow-600 px-3 py-2 text-sm font-semibold text-white hover:bg-yellow-700 disabled:opacity-50"
        >
          ⚙️ Settle Epoch
        </button>
        <button
          onClick={claimSettlement}
          disabled={isMining}
          className="rounded bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          💰 Claim
        </button>
        <button
          onClick={resetToCommitPhase}
          disabled={isMining}
          className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          🔄 New Epoch
        </button>
      </div>

      {isLocalhost && (
        <div className="mt-4 border-t border-amber-200 pt-4">
          <p className="mb-2 text-xs font-semibold text-amber-700">⚡ Fast Forward (Localhost Only)</p>
          <div className="mb-3 grid grid-cols-4 gap-2">
            <button
              onClick={() => mineBlocks(5)}
              disabled={isMining}
              className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              +5 Blocks
            </button>
            <button
              onClick={() => mineBlocks(10)}
              disabled={isMining}
              className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              +10 Blocks
            </button>
            <button
              onClick={() => mineBlocks(15)}
              disabled={isMining}
              className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              +15 Blocks
            </button>
            <button
              onClick={() => mineBlocks(25)}
              disabled={isMining}
              className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              +25 Blocks
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={blocksToMine}
              onChange={e => setBlocksToMine(e.target.value)}
              className="flex-1 rounded border border-amber-300 px-3 py-1 text-sm"
              placeholder="Blocks to mine"
            />
            <button
              onClick={() => mineBlocks(parseInt(blocksToMine) || 1)}
              disabled={isMining}
              className="rounded bg-amber-600 px-4 py-1 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {isMining ? "Mining..." : "Mine"}
            </button>
          </div>
        </div>
      )}

      {!isLocalhost && (
        <div className="mt-2 text-xs text-blue-700">
          <strong>Note:</strong> On testnet, wait for real blocks (~12 sec each). Phase durations: Commit: 5 blocks |
          Reveal: 5 blocks | Safety: 3 blocks
        </div>
      )}

      {isLocalhost && (
        <div className="mt-3 text-xs text-amber-700">
          <strong>Phase Durations:</strong> Commit: 5 blocks | Reveal: 5 blocks | Safety: 3 blocks
        </div>
      )}
    </div>
  );
}
