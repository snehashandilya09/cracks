"use client";

import { EpochData } from "~~/hooks/useClearSettle";

interface MarketViewTabProps {
  epochData: EpochData | null;
}

export function MarketViewTab({ epochData }: MarketViewTabProps) {
  if (!epochData) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-slate-500">Loading market data...</p>
      </div>
    );
  }

  const buyVolume = Number(epochData.totalBuyVolume);
  const sellVolume = Number(epochData.totalSellVolume);
  const matchedVolume = Number(epochData.matchedVolume);
  const maxVolume = Math.max(buyVolume, sellVolume, 1);

  const buyPercentage = (buyVolume / maxVolume) * 100;
  const sellPercentage = (sellVolume / maxVolume) * 100;
  const matchedPercentage = (matchedVolume / maxVolume) * 100;

  const clearingPrice = epochData.clearingPrice === 0n ? "Pending" : `$${Number(epochData.clearingPrice).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* Order Book Visualization */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Order Book</h3>

        <div className="mt-6 space-y-6">
          {/* Buy Side */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Buy Orders (Green)</span>
              <span className="text-sm font-semibold text-emerald-700">{buyVolume} ETH</span>
            </div>
            <div className="h-16 overflow-hidden rounded-lg bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-emerald-300 to-emerald-600 transition-all duration-300"
                style={{ width: `${buyPercentage}%` }}
              />
            </div>
          </div>

          {/* Matched Volume */}
          <div className="rounded-lg border-2 border-dashed border-blue-400 bg-blue-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-900">Matched Volume (Execution)</span>
              <span className="text-lg font-bold text-blue-700">{matchedVolume} ETH</span>
            </div>
            <div className="mt-3 h-8 overflow-hidden rounded-lg bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-blue-300 to-blue-600 transition-all duration-300"
                style={{ width: `${matchedPercentage}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-blue-700">
              ✓ Fair matching: min(buy, sell) ensures no over-execution
            </p>
          </div>

          {/* Sell Side */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Sell Orders (Red)</span>
              <span className="text-sm font-semibold text-rose-700">{sellVolume} ETH</span>
            </div>
            <div className="h-16 overflow-hidden rounded-lg bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-rose-300 to-rose-600 transition-all duration-300"
                style={{ width: `${sellPercentage}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Market Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Clearing Price</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{clearingPrice}</p>
          <p className="mt-2 text-xs text-slate-500">
            ✓ All executed orders at this uniform price (fair execution)
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Execution Rate</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {maxVolume > 0 ? ((matchedVolume / maxVolume) * 100).toFixed(1) : "0"}%
          </p>
          <p className="mt-2 text-xs text-slate-500">
            % of total volume that gets matched and executed
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Buy/Sell Imbalance</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {buyVolume > 0 ? ((buyVolume - sellVolume) / buyVolume * 100).toFixed(1) : "0"}%
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Market direction indicator (positive = more buys)
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">MEV Protection</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">✓ Active</p>
          <p className="mt-2 text-xs text-slate-500">
            Batch settlement + uniform price prevents MEV
          </p>
        </div>
      </div>

      {/* Market Info Card */}
      <div className="rounded-lg bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 p-6">
        <h4 className="font-semibold text-slate-900">How Fair Execution Works</h4>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>✓ <strong>Commit-Reveal:</strong> Orders hidden until reveal phase (no front-running)</li>
          <li>✓ <strong>Batch Execution:</strong> All orders execute together at one price</li>
          <li>✓ <strong>Uniform Price:</strong> No advantage for early/late orders</li>
          <li>✓ <strong>Pro-Rata Allocation:</strong> When oversubscribed, fair allocation to all</li>
          <li>✓ <strong>MEV Elimination:</strong> No sandwich/extraction possible</li>
        </ul>
      </div>
    </div>
  );
}
