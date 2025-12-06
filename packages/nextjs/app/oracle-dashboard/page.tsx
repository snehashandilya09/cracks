"use client";

import Link from "next/link";
import { useOracleHealth } from "~~/hooks/useOracleHealth";

export default function OracleDashboard() {
  const { oracles, aggregatedPrice, loading, error } = useOracleHealth();

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

          <h1 className="text-3xl font-bold text-slate-900">Oracle Health Monitor</h1>
          <p className="mt-2 text-slate-600">Real-time Byzantine-fault-tolerant price oracle aggregation</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-emerald-600 border-r-transparent"></div>
              <p className="mt-4 text-slate-600">Loading oracle data from Sepolia...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="rounded-lg border-2 border-red-300 bg-red-50 p-6">
            <h3 className="font-semibold text-red-900">Failed to Load Oracle Data</h3>
            <p className="mt-2 text-sm text-red-800">{error}</p>
            <p className="mt-2 text-xs text-red-700">Make sure you&apos;re connected to Sepolia testnet.</p>
          </div>
        )}

        {/* Data Display */}
        {!loading && !error && aggregatedPrice && (
          <>
            {/* Aggregated Price Card */}
            <div className="mb-8 rounded-lg border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-blue-50 p-8">
              <div className="text-center">
                <p className="text-sm font-semibold uppercase text-slate-600">Aggregated ETH Price</p>
                <p className="mt-3 text-5xl font-bold text-emerald-700">${aggregatedPrice.price.toFixed(2)}</p>

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                    <p className="text-xs font-semibold uppercase text-slate-600">Confidence</p>
                    <p className="mt-2 text-2xl font-bold text-blue-600">{aggregatedPrice.confidence}%</p>
                  </div>

                  <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                    <p className="text-xs font-semibold uppercase text-slate-600">Max Deviation</p>
                    <p className="mt-2 text-2xl font-bold text-amber-600">{aggregatedPrice.deviation.toFixed(2)}%</p>
                  </div>

                  <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                    <p className="text-xs font-semibold uppercase text-slate-600">Active Sources</p>
                    <p className="mt-2 text-2xl font-bold text-purple-600">{aggregatedPrice.activeSources}/3</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-center gap-2">
                  <span
                    className={`h-3 w-3 rounded-full ${aggregatedPrice.healthy ? "bg-emerald-500" : "bg-red-500"}`}
                  />
                  <p className="text-sm font-semibold text-slate-700">
                    {aggregatedPrice.healthy ? "✓ Healthy" : "⚠️ Degraded"}
                  </p>
                </div>
              </div>
            </div>

            {/* Oracle Sources Grid */}
            <div className="mb-8">
              <h2 className="mb-4 text-2xl font-bold text-slate-900">Oracle Sources</h2>
              <div className="grid gap-6 md:grid-cols-3">
                {oracles.map(oracle => (
                  <div
                    key={oracle.name}
                    className={`rounded-lg border-2 p-6 transition-all ${
                      oracle.healthy ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-slate-900">{oracle.name}</h3>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          oracle.healthy ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                        }`}
                      >
                        {oracle.healthy ? "✓ Online" : "⚠️ Issue"}
                      </span>
                    </div>

                    <p className="mt-4 text-3xl font-bold text-slate-900">${oracle.price.toFixed(2)}</p>

                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Last Update</span>
                        <span className="font-mono font-semibold text-slate-900">{oracle.updateTime}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Staleness</span>
                        <span
                          className={`font-mono font-semibold ${
                            oracle.staleness < 300
                              ? "text-emerald-600"
                              : oracle.staleness < 3600
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {oracle.staleness}s
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Confidence</span>
                        <span className="font-mono font-semibold text-blue-600">{oracle.confidence}%</span>
                      </div>
                    </div>

                    {/* Health Bar */}
                    <div className="mt-4">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={`h-full transition-all ${oracle.healthy ? "bg-emerald-500" : "bg-red-500"}`}
                          style={{
                            width: `${(oracle.confidence / 100) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Byzantine Tolerance Info */}
            <div className="mb-8 rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">Byzantine Fault Tolerance</h2>

              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <h3 className="font-semibold text-blue-900">2/3 Honest Oracle Requirement</h3>
                  <p className="mt-2 text-sm text-blue-800">
                    The protocol requires that at least 2 out of 3 oracles are honest. This means:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-blue-800 ml-4">
                    <li>• If 1 oracle is compromised, the other 2 dominate the result</li>
                    <li>• An attacker must compromise 2+ oracles to manipulate prices</li>
                    <li>• Even if Chainlink gives wrong price, Pyth + Uniswap correct it</li>
                  </ul>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-900">Median Aggregation</h3>
                  <p className="mt-2 text-sm text-slate-700">
                    Final price is the <strong>median</strong> of all three sources, not the mean. This ensures:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700 ml-4">
                    <li>• Outlier prices do not affect the final result</li>
                    <li>• At least one honest oracle price is always in the result</li>
                    <li>• Flash loan attacks targeting one source are neutralized</li>
                  </ul>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-semibold text-amber-900">Staleness Checks</h3>
                  <p className="mt-2 text-sm text-amber-800">
                    Each oracle has a maximum acceptable age before being considered stale:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800 ml-4">
                    <li>• Chainlink: 3600 seconds (1 hour)</li>
                    <li>• Pyth: 60 seconds (high frequency updates)</li>
                    <li>• Uniswap V3: 1800 seconds (30 minute TWAP window)</li>
                  </ul>
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <h3 className="font-semibold text-emerald-900">Deviation Limits</h3>
                  <p className="mt-2 text-sm text-emerald-800">
                    If any oracle price deviates more than 30% from the consensus, it is flagged as suspicious:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-emerald-800 ml-4">
                    <li>• Protects against temporary oracle glitches</li>
                    <li>• Prevents accepting clearly incorrect prices</li>
                    <li>• Still allows 30% market movements (legitimate volatility)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Security Guarantees */}
            <div className="rounded-lg border-2 border-purple-300 bg-purple-50 p-6">
              <h2 className="text-lg font-semibold text-purple-900">Security Guarantees</h2>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                  <p className="font-semibold text-slate-900">✓ Flash Loan Resistant</p>
                  <p className="mt-1 text-sm text-slate-700">
                    TWAP and external oracles cannot be manipulated by short-term price movements
                  </p>
                </div>

                <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                  <p className="font-semibold text-slate-900">✓ Multi-Source Diversification</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Three completely independent oracle sources prevent single-point-of-failure
                  </p>
                </div>

                <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                  <p className="font-semibold text-slate-900">✓ Consensus-Based</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Majority agreement ensures robustness against minority compromise
                  </p>
                </div>

                <div className="rounded-lg bg-white bg-opacity-60 backdrop-blur p-4">
                  <p className="font-semibold text-slate-900">✓ Explicit Health Monitoring</p>
                  <p className="mt-1 text-sm text-slate-700">
                    Real-time staleness and deviation checks catch oracle issues immediately
                  </p>
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
          </>
        )}
      </div>
    </div>
  );
}
