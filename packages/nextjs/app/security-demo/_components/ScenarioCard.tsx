"use client";

import { useState } from "react";
import toast from "react-hot-toast";

interface Scenario {
  id: string;
  title: string;
  description: string;
  attack: string;
  protection: string;
  result: "protected" | "blocked" | "prevented";
  details: string[];
}

interface ScenarioCardProps {
  scenario: Scenario;
}

export function ScenarioCard({ scenario }: ScenarioCardProps) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const handleSimulate = async () => {
    setIsSimulating(true);
    setShowResult(false);

    // Simulate attack
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setShowResult(true);
    setIsSimulating(false);

    // Show toast notification
    if (scenario.result === "protected" || scenario.result === "blocked") {
      toast.success(`✓ ${scenario.title} - Attack blocked!`);
    } else {
      toast.success(`✓ ${scenario.title} - Attack prevented!`);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden transition-all hover:shadow-lg">
      {/* Header */}
      <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900">{scenario.title}</h3>
        <p className="mt-1 text-sm text-slate-600">{scenario.description}</p>
      </div>

      {/* Content */}
      <div className="p-6 space-y-4">
        {/* Attack Details */}
        <div>
          <h4 className="text-sm font-semibold text-slate-900 mb-2">Attack Vector:</h4>
          <p className="text-sm text-slate-700 bg-red-50 border border-red-200 rounded-lg p-3">
            ⚠️ {scenario.attack}
          </p>
        </div>

        {/* Protection Mechanism */}
        <div>
          <h4 className="text-sm font-semibold text-slate-900 mb-2">Protection:</h4>
          <p className="text-sm text-slate-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            🛡️ {scenario.protection}
          </p>
        </div>

        {/* Details */}
        <div>
          <h4 className="text-sm font-semibold text-slate-900 mb-2">How It Works:</h4>
          <ul className="space-y-1">
            {scenario.details.map((detail, idx) => (
              <li key={idx} className="text-xs text-slate-600 flex gap-2">
                <span className="text-emerald-600 font-bold">•</span>
                {detail}
              </li>
            ))}
          </ul>
        </div>

        {/* Result Display */}
        {showResult && (
          <div
            className={`rounded-lg border-2 p-4 ${
              scenario.result === "protected" || scenario.result === "blocked"
                ? "border-emerald-300 bg-emerald-50"
                : "border-blue-300 bg-blue-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">
                {scenario.result === "protected" || scenario.result === "blocked" ? "✓" : "✓"}
              </span>
              <div>
                <p className="font-semibold text-emerald-900">
                  Attack {scenario.result === "blocked" ? "Blocked" : "Prevented"}!
                </p>
                <p className="text-sm text-emerald-700 mt-1">
                  {scenario.result === "protected"
                    ? "The system's design prevents this attack from succeeding."
                    : "The protocol detects and prevents this attack."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isSimulating && (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin">⏳</div>
              <div>
                <p className="font-semibold text-amber-900">Simulating attack...</p>
                <p className="text-sm text-amber-700 mt-1">Running attack scenario...</p>
              </div>
            </div>
          </div>
        )}

        {/* Simulate Button */}
        <button
          onClick={handleSimulate}
          disabled={isSimulating}
          className={`w-full rounded-lg px-4 py-3 font-semibold text-white transition-colors ${
            isSimulating
              ? "bg-slate-400 cursor-not-allowed opacity-50"
              : "bg-amber-600 hover:bg-amber-700 cursor-pointer"
          }`}
        >
          {isSimulating ? "Simulating..." : "Simulate Attack"}
        </button>
      </div>
    </div>
  );
}
