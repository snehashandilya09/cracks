"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClearSettle } from "../../hooks/useClearSettle";
import { CommitTab } from "./_components/CommitTab";
import { DevTools } from "./_components/DevTools";
import { Header } from "./_components/Header";
import { InvariantStatusPanel } from "./_components/InvariantStatusPanel";
import { MarketViewTab } from "./_components/MarketViewTab";
import { Navigation } from "./_components/Navigation";
import { RevealTab } from "./_components/RevealTab";
import { StatsTab } from "./_components/StatsTab";
import { StatusPanel } from "./_components/StatusPanel";

type TabType = "commit" | "reveal" | "market" | "stats";

export default function ClearSettleDashboard() {
  const { currentBlock, epochData, currentPhase, refetchEpoch } = useClearSettle();
  const [activeTab, setActiveTab] = useState<TabType>("commit");

  // Auto-refetch on block changes
  useEffect(() => {
    if (currentBlock > 0n) {
      refetchEpoch();
    }
  }, [currentBlock, refetchEpoch]);

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: "commit", label: "Commit Order", icon: "📝" },
    { id: "reveal", label: "Reveal & Settle", icon: "🔓" },
    { id: "market", label: "Market View", icon: "📊" },
    { id: "stats", label: "Statistics", icon: "📈" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navigation */}
      <Navigation />

      {/* Header */}
      <Header currentBlock={currentBlock} epochId={epochData?.epochId ?? 0n} />

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Dev Tools - For Testing */}
        <div className="mb-6">
          <DevTools />
        </div>

        {/* Invariant Status Panel - Module 1 Showcase */}
        <div className="mb-6">
          <InvariantStatusPanel />
        </div>

        {/* Status Panel */}
        <StatusPanel epochData={epochData} currentPhase={currentPhase} />

        {/* Tab Navigation */}
        <div className="mt-8 border-b border-slate-200 bg-white rounded-t-lg">
          <div className="flex gap-8 px-6 sm:px-8">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-1 py-4 border-b-2 font-medium text-sm transition-all ${
                  activeTab === tab.id
                    ? "border-emerald-500 text-emerald-600"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white p-6 sm:p-8">
          {activeTab === "commit" && <CommitTab currentPhase={currentPhase?.phase ?? null} />}
          {activeTab === "reveal" && <RevealTab currentPhase={currentPhase?.phase ?? null} />}
          {activeTab === "market" && <MarketViewTab epochData={epochData} />}
          {activeTab === "stats" && <StatsTab epochData={epochData} />}
        </div>

        {/* Footer Info */}
        <div className="mt-8 rounded-lg bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200 p-6">
          <h3 className="font-semibold text-slate-900">How ClearSettle Works</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm text-slate-700">
            <div>
              <span className="font-semibold text-blue-600">1. Commit</span>
              <p className="mt-1">Submit encrypted order with bond</p>
            </div>
            <div>
              <span className="font-semibold text-purple-600">2. Reveal</span>
              <p className="mt-1">Publish order details & get bond back</p>
            </div>
            <div>
              <span className="font-semibold text-amber-600">3. Settle</span>
              <p className="mt-1">Fair matching at uniform clearing price</p>
            </div>
            <div>
              <span className="font-semibold text-emerald-600">4. Claim</span>
              <p className="mt-1">Withdraw your settlement results</p>
            </div>
          </div>
        </div>

        {/* Demo Sections */}
        <div className="mt-12 space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Explore the Protocol</h2>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Security Demo */}
            <Link
              href="/security-demo"
              className="group rounded-lg border-2 border-slate-200 bg-white p-6 transition-all hover:border-emerald-400 hover:shadow-lg"
            >
              <div className="text-3xl mb-3">🛡️</div>
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
                Security Demonstrations
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                See how ClearSettle protects against front-running, sandwich attacks, and other DeFi threats
              </p>
              <div className="mt-4 flex items-center gap-2 text-emerald-600 font-semibold text-sm">Explore →</div>
            </Link>

            {/* Oracle Dashboard */}
            <Link
              href="/oracle-dashboard"
              className="group rounded-lg border-2 border-slate-200 bg-white p-6 transition-all hover:border-emerald-400 hover:shadow-lg"
            >
              <div className="text-3xl mb-3">💎</div>
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
                Oracle Health Monitor
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Real-time Byzantine-fault-tolerant price oracle aggregation with multi-source verification
              </p>
              <div className="mt-4 flex items-center gap-2 text-emerald-600 font-semibold text-sm">Monitor →</div>
            </Link>

            {/* Finality Tracker */}
            <Link
              href="/finality-tracker"
              className="group rounded-lg border-2 border-slate-200 bg-white p-6 transition-all hover:border-emerald-400 hover:shadow-lg"
            >
              <div className="text-3xl mb-3">⛓️</div>
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
                Finality & Reorg Safety
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Track settlement batch finalization and reorg protection mechanisms in real-time
              </p>
              <div className="mt-4 flex items-center gap-2 text-emerald-600 font-semibold text-sm">Track →</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
