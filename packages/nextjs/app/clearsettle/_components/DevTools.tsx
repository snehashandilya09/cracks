"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { usePublicClient, useWaitForTransactionReceipt, useWalletClient, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

/**
 * DevTools Component - For Testing Only
 *
 * Provides shortcuts for testing the full flow without waiting for blocks:
 * 1. Mine N blocks instantly (localhost only)
 * 2. Skip to next phase
 * 3. Reset epoch
 */
const chainId = 31337;
const CONTRACT = deployedContracts[chainId]?.ClearSettle;

export function DevTools() {
  const [blocksToMine, setBlocksToMine] = useState("60");
  const [isMining, setIsMining] = useState(false);
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContract, data: resetTxHash } = useWriteContract();

  // Wait for reset transaction confirmation
  const { isSuccess: resetConfirmed } = useWaitForTransactionReceipt({
    hash: resetTxHash,
  });

  // Force page reload when reset is confirmed
  useEffect(() => {
    if (resetConfirmed && resetTxHash) {
      toast.success("✅ Reset complete! Refreshing...");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }, [resetConfirmed, resetTxHash]);

  const mineBlocks = async (count: number) => {
    if (!publicClient || !walletClient) {
      toast.error("Wallet not connected");
      return;
    }

    setIsMining(true);
    try {
      // Mine blocks on hardhat localhost
      await walletClient.request({
        method: "hardhat_mine" as any,
        params: [`0x${count.toString(16)}`], // Convert to hex
      });

      toast.success(`Mined ${count} blocks!`);

      // Force UI refresh by getting new block number
      const newBlock = await publicClient.getBlockNumber();
      console.log("New block:", newBlock);
    } catch (e: any) {
      console.error("Mining error:", e);
      toast.error(`Mining failed: ${e.message || "Are you on localhost?"}`);
    } finally {
      setIsMining(false);
    }
  };

  const skipToNextPhase = () => {
    // Mine 60 blocks to skip one phase
    mineBlocks(60);
  };

  const skipToRevealPhase = () => {
    // Mine 60 blocks to reach reveal phase from commit
    mineBlocks(60);
  };

  const skipToSettlePhase = () => {
    // Mine 120 blocks to reach settle phase
    mineBlocks(120);
  };

  const skipToFinalPhase = () => {
    // Mine 130+ blocks to reach finalized
    mineBlocks(135);
  };

  const resetToCommitPhase = async () => {
    if (!CONTRACT) {
      toast.error("Contract not found");
      return;
    }

    setIsMining(true);
    try {
      toast("Calling resetForDemo()...", { icon: "🔄" });
      writeContract({
        address: CONTRACT.address as `0x${string}`,
        abi: CONTRACT.abi,
        functionName: "resetForDemo",
      });
      // Transaction confirmation handled by useEffect above
    } catch (e: any) {
      console.error("Reset error:", e);
      toast.error(`Failed: ${e.message || "Unknown error"}`);
      setIsMining(false);
    }
  };

  // Settle the current epoch (call after reveal phase)
  const settleEpoch = async () => {
    if (!CONTRACT) {
      toast.error("Contract not found");
      return;
    }

    setIsMining(true);
    try {
      toast("Settling epoch...", { icon: "⚙️" });
      writeContract({
        address: CONTRACT.address as `0x${string}`,
        abi: CONTRACT.abi,
        functionName: "settleEpoch",
      });
      toast.success("Settle transaction submitted!");
    } catch (e: any) {
      console.error("Settle error:", e);
      toast.error(`Failed: ${e.message || "Unknown error"}`);
    } finally {
      setIsMining(false);
    }
  };

  // Claim settlement (call after finalized)
  const claimSettlement = async () => {
    if (!CONTRACT || !publicClient) {
      toast.error("Contract not found");
      return;
    }

    setIsMining(true);
    try {
      // Get current epoch ID
      const epochId = await publicClient.readContract({
        address: CONTRACT.address as `0x${string}`,
        abi: CONTRACT.abi,
        functionName: "getCurrentEpochId",
      });

      toast("Claiming settlement...", { icon: "💰" });
      writeContract({
        address: CONTRACT.address as `0x${string}`,
        abi: CONTRACT.abi,
        functionName: "claimSettlement",
        args: [epochId],
      });
      toast.success("Claim transaction submitted!");
    } catch (e: any) {
      console.error("Claim error:", e);
      toast.error(`Failed: ${e.message || "Unknown error"}`);
    } finally {
      setIsMining(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">🛠️</span>
        <h3 className="font-bold text-amber-900">Dev Tools (Testing Only)</h3>
      </div>

      <p className="text-xs text-amber-700 mb-4">
        Only works on localhost. Instantly mine blocks to test phase transitions.
      </p>

      {/* Quick Skip Buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <button
          onClick={skipToRevealPhase}
          disabled={isMining}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          ⏭️ Skip to Reveal
        </button>

        <button
          onClick={skipToSettlePhase}
          disabled={isMining}
          className="rounded bg-purple-600 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          ⏭️ Skip to Settle
        </button>

        <button
          onClick={skipToFinalPhase}
          disabled={isMining}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          ⏭️ Skip to Final
        </button>

        <button
          onClick={resetToCommitPhase}
          disabled={isMining}
          className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          🔄 Reset to COMMIT
        </button>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
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
          💰 Claim Settlement
        </button>

        <button
          onClick={skipToNextPhase}
          disabled={isMining}
          className="rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          ⏭️ Skip +60 Blocks
        </button>
      </div>

      {/* Custom Mine */}
      <div className="flex gap-2">
        <input
          type="number"
          value={blocksToMine}
          onChange={e => setBlocksToMine(e.target.value)}
          placeholder="Number of blocks"
          className="flex-1 rounded border border-amber-300 px-3 py-2 text-sm"
        />
        <button
          onClick={() => mineBlocks(parseInt(blocksToMine))}
          disabled={isMining}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isMining ? "Mining..." : "Mine Blocks"}
        </button>
      </div>

      <div className="mt-3 text-xs text-amber-700">
        <strong>Phase Durations:</strong> Commit: 60 blocks | Reveal: 60 blocks | Safety: 10 blocks
        <br />
        <strong className="text-indigo-700">Tip:</strong> Use Reset to COMMIT Phase to start a fresh epoch anytime!
      </div>
    </div>
  );
}
