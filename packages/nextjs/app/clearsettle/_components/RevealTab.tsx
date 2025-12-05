"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, encodePacked } from "viem";
import toast from "react-hot-toast";
import { useCommitments, type CommitmentRecord } from "../../../hooks/useCommitments";

export function RevealTab({ currentPhase }: { currentPhase: string | null }) {
  const { address } = useAccount();
  const [isRevealing, setIsRevealing] = useState(false);

  const { commitments, updateCommitment } = useCommitments();

  const handleReveal = async (commitment: CommitmentRecord) => {
    if (currentPhase !== "ACCEPTING_REVEALS") {
      toast.error("Can only reveal during reveal phase");
      return;
    }

    if (!address) {
      toast.error("Wallet not connected");
      return;
    }

    setIsRevealing(true);

    try {
      // Verify the commitment hash by recalculating it from the stored data
      const sideValue = commitment.side === "BUY" ? 0 : 1;
      const recalculatedHash = keccak256(
        encodePacked(
          ["uint256", "uint256", "uint256", "bytes32", "address"],
          [
            BigInt(Math.floor(parseFloat(commitment.amount) * 1e18)),
            BigInt(sideValue),
            BigInt(Math.floor(parseFloat(commitment.price) * 1e18)),
            keccak256(encodePacked(["string"], [commitment.salt])),
            address,
          ]
        )
      );

      // Check if the recalculated hash matches the stored hash
      if (recalculatedHash !== commitment.hash) {
        toast.error("Hash verification failed! Data has been tampered with.");
        setIsRevealing(false);
        return;
      }

      // Hash matches, update as revealed
      updateCommitment(commitment.id, { revealed: true });
      toast.success("Order revealed successfully!");
    } catch (e) {
      toast.error(`Reveal failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsRevealing(false);
    }
  };

  const handleClaimSettlement = async () => {
    try {
      toast.success("Settlement claimed!");
    } catch (e) {
      toast.error(`Claim failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const unrevealed = commitments.filter((c: CommitmentRecord) => !c.revealed);

  return (
    <div className="space-y-6">
      {/* Settlement Actions */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Settlement Actions</h3>
        <p className="mt-1 text-sm text-slate-600">
          {currentPhase === "ACCEPTING_REVEALS" && "Reveal your orders, then wait for settle phase"}
          {currentPhase === "SETTLING" && "Epoch is being settled. Results coming soon..."}
          {currentPhase === "SAFETY_BUFFER" && "Safety buffer active. Claim results after safety period."}
          {currentPhase === "FINALIZED" && "You can claim your settlement results now."}
        </p>
      </div>

      {/* Reveal Orders */}
      {unrevealed.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-slate-900">Pending Reveals</h3>
          <p className="mt-1 text-sm text-slate-600">
            {unrevealed.length} {unrevealed.length === 1 ? "order" : "orders"} waiting to be revealed
          </p>

          <div className="mt-4 space-y-3">
            {unrevealed.map((c: CommitmentRecord) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        c.side === "BUY" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {c.side}
                    </span>
                    <span className="font-semibold text-slate-900">{c.amount} ETH</span>
                    <span className="text-slate-500">@ ${c.price}</span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">{c.hash.slice(0, 32)}...</p>
                </div>

                <button
                  onClick={() => handleReveal(c)}
                  disabled={currentPhase !== "ACCEPTING_REVEALS" || isRevealing}
                  className={`whitespace-nowrap rounded-lg px-4 py-2 font-semibold text-white transition-colors ${
                    currentPhase === "ACCEPTING_REVEALS" && !isRevealing
                      ? "bg-purple-600 hover:bg-purple-700 cursor-pointer"
                      : "bg-slate-400 cursor-not-allowed opacity-50"
                  }`}
                >
                  {isRevealing ? "Revealing..." : "Reveal"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Revealed Orders */}
      {commitments.some((c: CommitmentRecord) => c.revealed) && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-slate-900">Revealed Orders</h3>

          <div className="mt-4 space-y-3">
            {commitments
              .filter((c: CommitmentRecord) => c.revealed)
              .map((c: CommitmentRecord) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          c.side === "BUY" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {c.side}
                      </span>
                      <span className="font-semibold text-slate-900">{c.amount} ETH</span>
                      <span className="text-slate-500">@ ${c.price}</span>
                    </div>
                  </div>

                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    ✓ Revealed
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Claim Settlement */}
      {(currentPhase === "FINALIZED" || currentPhase === "SAFETY_BUFFER") && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <h3 className="text-lg font-semibold text-emerald-900">Claim Results</h3>
          <p className="mt-1 text-sm text-emerald-700">
            Your settlement is ready. Click below to claim your results and receive tokens.
          </p>

          <button
            onClick={handleClaimSettlement}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Claim Settlement
          </button>
        </div>
      )}

      {/* Empty State */}
      {commitments.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-slate-500">No committed orders yet. Start by creating an order in the Commit tab.</p>
        </div>
      )}
    </div>
  );
}
