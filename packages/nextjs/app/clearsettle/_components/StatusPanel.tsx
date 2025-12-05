"use client";

import { CurrentPhaseInfo, EpochData } from "../../../hooks/useClearSettle";

interface StatusPanelProps {
  epochData: EpochData | null;
  currentPhase: CurrentPhaseInfo | null;
}

const PHASE_COLORS: { [key: string]: string } = {
  UNINITIALIZED: "bg-slate-50 border-slate-200 text-slate-900",
  ACCEPTING_COMMITS: "bg-blue-50 border-blue-200 text-blue-900",
  ACCEPTING_REVEALS: "bg-purple-50 border-purple-200 text-purple-900",
  SETTLING: "bg-yellow-50 border-yellow-200 text-yellow-900",
  IN_TRANSITION: "bg-amber-50 border-amber-200 text-amber-900",
  SAFETY_BUFFER: "bg-orange-50 border-orange-200 text-orange-900",
  FINALIZED: "bg-green-50 border-green-200 text-green-900",
  VOID: "bg-red-50 border-red-200 text-red-900",
};

const PHASE_BADGES: { [key: string]: string } = {
  UNINITIALIZED: "bg-slate-100 text-slate-800",
  ACCEPTING_COMMITS: "bg-blue-100 text-blue-800",
  ACCEPTING_REVEALS: "bg-purple-100 text-purple-800",
  SETTLING: "bg-yellow-100 text-yellow-800",
  IN_TRANSITION: "bg-amber-100 text-amber-800",
  SAFETY_BUFFER: "bg-orange-100 text-orange-800",
  FINALIZED: "bg-emerald-100 text-emerald-800",
  VOID: "bg-red-100 text-red-800",
};

export function StatusPanel({ epochData, currentPhase }: StatusPanelProps) {
  if (!epochData || !currentPhase) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-slate-500">Loading epoch data...</p>
      </div>
    );
  }

  const formatPrice = (price: bigint) => {
    if (price === 0n) return "Pending";
    return `$${Number(price).toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      {/* Phase Status Card */}
      <div className={`rounded-lg border-2 p-6 ${PHASE_COLORS[currentPhase.phase]}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide opacity-75">Current Phase</p>
            <p className="mt-2 text-2xl font-bold">{currentPhase.phase.replace(/_/g, " ")}</p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${PHASE_BADGES[currentPhase.phase]}`}>
            {currentPhase.phase.replace(/_/g, " ")}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm">
            <span>Progress</span>
            <span>{currentPhase.percentComplete.toFixed(0)}%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-white bg-opacity-50">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-300"
              style={{ width: `${currentPhase.percentComplete}%` }}
            />
          </div>
        </div>

        {/* Blocks Remaining */}
        <p className="mt-3 text-sm opacity-75">
          {currentPhase.blocksRemaining} blocks remaining (~{(currentPhase.blocksRemaining * 12) / 60} minutes)
        </p>
      </div>

      {/* Volumes Card */}
      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2">
        <div className="rounded-lg bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Buy Volume</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{epochData.totalBuyVolume.toString()} ETH</p>
        </div>

        <div className="rounded-lg bg-pink-200 p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Sell Volume</p>
          <p className="mt-2 text-2xl font-bold text-pink-700">{epochData.totalSellVolume.toString()} ETH</p>
        </div>

        <div className="rounded-lg bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Matched Volume</p>
          <p className="mt-2 text-2xl font-bold text-blue-700">{epochData.matchedVolume.toString()} ETH</p>
        </div>

        <div className="rounded-lg bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-600">Clearing Price</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{formatPrice(epochData.clearingPrice)}</p>
        </div>
      </div>
    </div>
  );
}
