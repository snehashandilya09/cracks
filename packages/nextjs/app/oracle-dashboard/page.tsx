"use client";

import Link from "next/link";

export default function OracleDashboard() {
  // Oracle aggregator contract is not yet deployed - show placeholder
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
          <p className="mt-2 text-slate-600">
            Byzantine-fault-tolerant price oracle aggregation
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-6">
          <h2 className="text-lg font-semibold text-blue-900">Oracle Aggregator Not Yet Deployed</h2>
          <p className="mt-2 text-sm text-blue-700">
            The OracleAggregator contract will be deployed in the next phase. For now, focus on testing the main ClearSettle protocol:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-blue-700">
            <li>Commit orders with hidden hashes</li>
            <li>Reveal orders during reveal phase</li>
            <li>Watch phase progression automatically</li>
            <li>Verify settlement logic</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
