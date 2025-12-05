"use client";

import { EpochData } from "~~/hooks/useClearSettle";

interface StatsTabProps {
  epochData: EpochData | null;
}

export function StatsTab({ epochData }: StatsTabProps) {
  if (!epochData) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-slate-500">Loading statistics...</p>
      </div>
    );
  }

  const buyVolume = Number(epochData.totalBuyVolume);
  const sellVolume = Number(epochData.totalSellVolume);
  const matchedVolume = Number(epochData.matchedVolume);
  const totalVolume = buyVolume + sellVolume;

  const proRataRatio = matchedVolume > 0 ? (matchedVolume / Math.max(buyVolume, sellVolume) * 100) : 0;
  const executionEfficiency = totalVolume > 0 ? (matchedVolume / totalVolume * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Total Volume</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalVolume} ETH</p>
          <p className="mt-2 text-xs text-slate-500">Buy + Sell combined</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Matched Volume</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{matchedVolume} ETH</p>
          <p className="mt-2 text-xs text-slate-500">Successfully executed</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Execution Efficiency</p>
          <p className="mt-2 text-2xl font-bold text-blue-600">{executionEfficiency.toFixed(1)}%</p>
          <p className="mt-2 text-xs text-slate-500">Matched vs total orders</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Pro-Rata Allocation</p>
          <p className="mt-2 text-2xl font-bold text-purple-600">{proRataRatio.toFixed(1)}%</p>
          <p className="mt-2 text-xs text-slate-500">Fair allocation ratio</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Buy Orders</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{buyVolume} ETH</p>
          <p className="mt-2 text-xs text-slate-500">{totalVolume > 0 ? ((buyVolume / totalVolume) * 100).toFixed(1) : "0"}% of total</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Sell Orders</p>
          <p className="mt-2 text-2xl font-bold text-rose-600">{sellVolume} ETH</p>
          <p className="mt-2 text-xs text-slate-500">{totalVolume > 0 ? ((sellVolume / totalVolume) * 100).toFixed(1) : "0"}% of total</p>
        </div>
      </div>

      {/* Protocol Stats */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Protocol Statistics</h3>

        <div className="mt-4 space-y-3 divide-y divide-slate-200">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Current Epoch ID</span>
            <span className="font-semibold text-slate-900">#{epochData.epochId.toString()}</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Current Phase</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
              {epochData.disputed ? "DISPUTED" : "Active"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Clearing Price</span>
            <span className="font-semibold text-slate-900">
              {epochData.clearingPrice === 0n ? "Pending" : `$${Number(epochData.clearingPrice).toFixed(2)}`}
            </span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Dispute Status</span>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
              epochData.disputed
                ? "bg-red-100 text-red-800"
                : "bg-emerald-100 text-emerald-800"
            }`}>
              {epochData.disputed ? "⚠️ Disputed" : "✓ Clear"}
            </span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Settlement Fee</span>
            <span className="font-semibold text-slate-900">0.3% (30 bps)</span>
          </div>
        </div>
      </div>

      {/* Fair Execution Indicators */}
      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-6">
        <h3 className="text-lg font-semibold text-emerald-900">Fair Execution Checklist</h3>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>No Front-Running:</strong> Orders hidden until reveal</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>No Sandwich:</strong> Uniform clearing price for all</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>No MEV:</strong> Batch execution prevents extraction</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>Fair Allocation:</strong> Pro-rata matching when oversubscribed</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>Griefing Protected:</strong> Bonds slashed for non-revealers</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
              ✓
            </span>
            <span className="text-slate-700"><strong>Reorg Safe:</strong> Safety buffer prevents shallow reorgs</span>
          </div>
        </div>
      </div>

      {/* Economics Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Protocol Economics</h3>

        <div className="mt-4 space-y-3 divide-y divide-slate-200">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Bond Amount (Per Order)</span>
            <span className="font-semibold text-slate-900">0.01 ETH</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Settlement Fee</span>
            <span className="font-semibold text-slate-900">30 basis points (0.3%)</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Bond Purpose</span>
            <span className="text-sm text-slate-600">Anti-griefing: Returned on reveal, slashed if ignored</span>
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-slate-700">Estimated Fee on 1000 ETH Trade</span>
            <span className="font-semibold text-slate-900">3 ETH</span>
          </div>
        </div>
      </div>
    </div>
  );
}
