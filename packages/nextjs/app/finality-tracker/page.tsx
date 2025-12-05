"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface Batch {
  id: number;
  status: "PENDING" | "LOGGED" | "CHECKPOINTED";
  l1BlockNumber: number;
  currentBlock: number;
  blocksUntilFinality: number;
  nullifiers: string[];
}

export default function FinalityTrackerPage() {
  const [batches, setBatches] = useState<Batch[]>([
    {
      id: 1,
      status: "CHECKPOINTED",
      l1BlockNumber: 18500000,
      currentBlock: 18500120,
      blocksUntilFinality: 0,
      nullifiers: [
        "0x1234...5678",
        "0x9abc...def0",
        "0x2468...ace0",
      ],
    },
    {
      id: 2,
      status: "LOGGED",
      l1BlockNumber: 18500050,
      currentBlock: 18500120,
      blocksUntilFinality: 30,
      nullifiers: [
        "0x3579...bdf1",
        "0x2468...bdf2",
      ],
    },
    {
      id: 3,
      status: "PENDING",
      l1BlockNumber: 18500120,
      currentBlock: 18500120,
      blocksUntilFinality: 64,
      nullifiers: [
        "0xabcd...ef01",
      ],
    },
  ]);

  const LOOKBACK_DISTANCE = 64; // Blocks

  // Simulate block progression
  useEffect(() => {
    const interval = setInterval(() => {
      setBatches((prev) =>
        prev.map((batch) => {
          let newStatus = batch.status;
          let blocksUntilFinality = Math.max(
            0,
            LOOKBACK_DISTANCE - (batch.currentBlock + 1 - batch.l1BlockNumber)
          );

          if (blocksUntilFinality === 0 && batch.status !== "CHECKPOINTED") {
            newStatus = "CHECKPOINTED";
          } else if (batch.status === "PENDING" && blocksUntilFinality < LOOKBACK_DISTANCE) {
            newStatus = "LOGGED";
          }

          return {
            ...batch,
            currentBlock: batch.currentBlock + 1,
            blocksUntilFinality,
            status: newStatus,
          };
        })
      );
    }, 3000); // Simulate block every 3 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-yellow-50 border-yellow-200";
      case "LOGGED":
        return "bg-blue-50 border-blue-200";
      case "CHECKPOINTED":
        return "bg-emerald-50 border-emerald-200";
      default:
        return "bg-slate-50 border-slate-200";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return "bg-yellow-100 text-yellow-800";
      case "LOGGED":
        return "bg-blue-100 text-blue-800";
      case "CHECKPOINTED":
        return "bg-emerald-100 text-emerald-800";
      default:
        return "bg-slate-100 text-slate-800";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Link
            href="/clearsettle"
            className="mb-4 inline-flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700"
          >
            ← Back to Dashboard
          </Link>

          <h1 className="text-3xl font-bold text-slate-900">Finality & Reorg Safety Tracker</h1>
          <p className="mt-2 text-slate-600">
            Monitor settlement batch finalization and reorg protection mechanisms
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Finality Explanation */}
        <div className="mb-8 rounded-lg border-2 border-blue-300 bg-blue-50 p-6">
          <h2 className="text-lg font-semibold text-blue-900">How Reorg Safety Works</h2>
          <p className="mt-2 text-sm text-blue-800">
            ClearSettle uses a multi-stage finality model to protect against chain reorganizations. Each batch progresses
            through stages, becoming increasingly immutable at each step.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-white bg-opacity-70 p-4">
              <p className="font-semibold text-slate-900">Stage 1: PENDING</p>
              <p className="mt-2 text-xs text-slate-700">
                Transaction in mempool, vulnerable to replacement and shallow reorgs (0-12 blocks)
              </p>
            </div>

            <div className="rounded-lg bg-white bg-opacity-70 p-4">
              <p className="font-semibold text-slate-900">Stage 2: LOGGED</p>
              <p className="mt-2 text-xs text-slate-700">
                Included in a block, protected against shallow reorgs but still vulnerable to deep reorgs (12-64 blocks)
              </p>
            </div>

            <div className="rounded-lg bg-white bg-opacity-70 p-4">
              <p className="font-semibold text-slate-900">Stage 3: CHECKPOINTED</p>
              <p className="mt-2 text-xs text-slate-700">
                After 64 blocks, considered immutable. Reorg would require {">"}50% network hashrate (economically infeasible)
              </p>
            </div>
          </div>
        </div>

        {/* Current Batches */}
        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-bold text-slate-900">Active Batches</h2>
          <div className="space-y-4">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className={`rounded-lg border-2 p-6 transition-all ${getStatusColor(batch.status)}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Batch #{batch.id}</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      L1 Block: {batch.l1BlockNumber} | Current Block: {batch.currentBlock}
                    </p>
                  </div>
                  <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getStatusBadge(batch.status)}`}>
                    {batch.status === "PENDING" && "⏳ Pending"}
                    {batch.status === "LOGGED" && "📝 Logged"}
                    {batch.status === "CHECKPOINTED" && "✓ Finalized"}
                  </span>
                </div>

                {/* Finality Progress */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-semibold text-slate-900">Finality Progress</span>
                    <span className="text-slate-600">
                      {LOOKBACK_DISTANCE - batch.blocksUntilFinality}/{LOOKBACK_DISTANCE} blocks
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full transition-all ${
                        batch.status === "CHECKPOINTED"
                          ? "bg-emerald-500"
                          : batch.status === "LOGGED"
                            ? "bg-blue-500"
                            : "bg-yellow-500"
                      }`}
                      style={{
                        width: `${(
                          ((LOOKBACK_DISTANCE - batch.blocksUntilFinality) / LOOKBACK_DISTANCE) *
                          100
                        ).toFixed(0)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Reorg Safety Info */}
                <div className="mt-4 rounded-lg bg-white bg-opacity-50 p-3">
                  {batch.status === "PENDING" && (
                    <div className="text-sm text-slate-700">
                      <p className="font-semibold">⚠️ Reorg Vulnerable</p>
                      <p>
                        This batch is in the mempool. Any reorg {">"}0 blocks could reverse it.{" "}
                        <strong>Wait for LOGGED status</strong>.
                      </p>
                    </div>
                  )}

                  {batch.status === "LOGGED" && (
                    <div className="text-sm text-blue-800">
                      <p className="font-semibold">⚠️ Shallow Reorg Risk</p>
                      <p>
                        Batch is logged but within the reorg window. Safe from shallow reorgs (&lt;12 blocks) but monitor
                        for deep reorgs. <strong>{batch.blocksUntilFinality} blocks until immutability</strong>.
                      </p>
                    </div>
                  )}

                  {batch.status === "CHECKPOINTED" && (
                    <div className="text-sm text-emerald-800">
                      <p className="font-semibold">✓ Finalized & Immutable</p>
                      <p>
                        This batch has passed the 64-block safety window. It is now immutable and cannot be reversed
                        unless the entire chain reorgs (economically infeasible).
                      </p>
                    </div>
                  )}
                </div>

                {/* Nullifiers */}
                <div className="mt-4">
                  <p className="text-sm font-semibold text-slate-900 mb-2">Transaction Nullifiers:</p>
                  <div className="space-y-1">
                    {batch.nullifiers.map((nullifier, idx) => (
                      <div
                        key={idx}
                        className="rounded bg-white bg-opacity-60 px-3 py-2 font-mono text-xs text-slate-700"
                      >
                        {nullifier}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Nullifiers prevent double-spending even if the batch is temporarily reverted during a reorg.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reorg Safety Mechanisms */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-slate-900">Idempotent Execution</h3>
            <p className="mt-2 text-sm text-slate-700">
              Even if a batch is reverted during a deep reorg, executing it again produces the same result. Users are
              protected because:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 ml-4">
              <li>• <strong>Nullifiers:</strong> keccak256(sender || nonce || payload) - does not include block number</li>
              <li>• <strong>Consumed tracking:</strong> Smart contract tracks which nullifiers have been used</li>
              <li>• <strong>Replay prevention:</strong> Using a nullifier twice is rejected onchain</li>
              <li>• <strong>Settlement idempotence:</strong> Settling same orders twice fails gracefully</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-slate-900">Ancestry Verification</h3>
            <p className="mt-2 text-sm text-slate-700">
              Batches are verified to have valid ancestry chains. Reorg detection works by:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 ml-4">
              <li>• <strong>Parent hash verification:</strong> Each batch proves parent hash matches history</li>
              <li>• <strong>Canonical chain:</strong> Only one parent hash = one valid chain at each height</li>
              <li>• <strong>Fork detection:</strong> Different parent hash = chain reorg detected</li>
              <li>• <strong>Dispute window:</strong> Can challenge batches within safety buffer</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-slate-900">Safety Buffer (64 Blocks)</h3>
            <p className="mt-2 text-sm text-slate-700">
              Ethereum's standard safe reorg distance is 64 blocks. Beyond this:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 ml-4">
              <li>• <strong>Probability:</strong> &lt;0.001% chance of reorg &gt;64 blocks</li>
              <li>• <strong>Cost:</strong> Would require &gt;50% network hashrate attacking</li>
              <li>• <strong>Detection:</strong> Such an attack would be publicly noticed immediately</li>
              <li>• <strong>Recovery:</strong> Even if reorg happens, idempotence protects users</li>
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-semibold text-slate-900">Multi-Layer Protection</h3>
            <p className="mt-2 text-sm text-slate-700">
              ClearSettle does not rely on single mechanism. Protection layers:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 ml-4">
              <li>• <strong>Layer 1:</strong> Commit-reveal hides orders during vulnerability window</li>
              <li>• <strong>Layer 2:</strong> Safety buffer ensures finality before settlement</li>
              <li>• <strong>Layer 3:</strong> Idempotent execution survives temporary reverts</li>
              <li>• <strong>Layer 4:</strong> Nullifier tracking prevents double-spending</li>
            </ul>
          </div>
        </div>

        {/* Statistics */}
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Safety Statistics</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Safety Buffer Blocks</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">64</p>
              <p className="mt-1 text-xs text-slate-500">Ethereum standard reorg distance</p>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Time to Finality (Mainnet)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">~15 min</p>
              <p className="mt-1 text-xs text-slate-500">64 blocks × ~12 sec/block</p>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Reorg Probability &gt;64 Blocks</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">&lt;0.001%</p>
              <p className="mt-1 text-xs text-slate-500">Based on Ethereum security model</p>
            </div>

            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Attack Cost (&gt;50% Hashrate)</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">$1B+</p>
              <p className="mt-1 text-xs text-slate-500">Economically infeasible for ROI</p>
            </div>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-8 text-center">
          <Link
            href="/clearsettle"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            ← Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
