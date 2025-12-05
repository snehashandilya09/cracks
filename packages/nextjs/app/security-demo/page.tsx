"use client";

import Link from "next/link";
import { ScenarioCard } from "./_components/ScenarioCard";

interface Scenario {
  id: string;
  title: string;
  description: string;
  attack: string;
  protection: string;
  result: "protected" | "blocked" | "prevented";
  details: string[];
}

const scenarios: Scenario[] = [
  {
    id: "front-running",
    title: "Front-Running Attack",
    description: "Attacker tries to see your order and outbid it",
    attack: "Attacker observes your pending transaction, extracts order details, and places a competing order first.",
    protection: "Commit-Reveal Scheme",
    result: "blocked",
    details: [
      "User submits order details hashed with salt (commitment phase)",
      "Attacker sees only the commitment hash - order details are completely hidden",
      "Reveal phase: User publishes original order, proving commitment matches",
      "Attacker never learns the details in time to outbid",
      "Fair execution guaranteed by uniform clearing price"
    ]
  },
  {
    id: "sandwich-attack",
    title: "Sandwich Attack",
    description: "Attacker tries to place orders before & after yours",
    attack: "Attacker tries to place orders around your trade to extract value from price movement.",
    protection: "Uniform Clearing Price Execution",
    result: "prevented",
    details: [
      "All orders execute at the same clearing price",
      "No sequential execution advantage - timing is irrelevant",
      "Attacker cannot profit from placing orders around yours",
      "Pro-rata allocation if oversubscribed ensures fairness",
      "MEV completely eliminated from batch settlement"
    ]
  },
  {
    id: "griefing",
    title: "Griefing / DoS Attack",
    description: "Attacker commits orders but refuses to reveal them",
    attack: "Attacker sends commits without revealing, blocking the protocol and wasting other users' time.",
    protection: "Bond Slashing Mechanism",
    result: "prevented",
    details: [
      "Every commit requires a 0.01 ETH bond (anti-spam measure)",
      "If user commits but doesn't reveal, bond is automatically slashed",
      "Economic penalty makes griefing attacks irrational",
      "Honest users always get their bonds back upon reveal",
      "Protocol can force advance if too many non-reveals occur"
    ]
  },
  {
    id: "replay",
    title: "Replay Attack",
    description: "Attacker tries to execute the same order twice",
    attack: "Attacker extracts a valid order and tries to execute it again in a different epoch.",
    protection: "Single Execution Invariant + Nullifiers",
    result: "blocked",
    details: [
      "Each order can only be revealed and executed once (single execution invariant)",
      "Nullifiers track consumed orders: keccak256(sender || nonce || payload)",
      "Reorg-safe design prevents replays across chain forks",
      "Commitment hash includes sender address (prevents cross-user replay)",
      "Any attempt to replay is cryptographically detectable"
    ]
  },
  {
    id: "oracle-manipulation",
    title: "Oracle Manipulation",
    description: "Attacker feeds false prices to influence settlement",
    attack: "Attacker compromises or manipulates price oracles to distort clearing price.",
    protection: "Byzantine Fault Tolerant Oracle Aggregation",
    result: "protected",
    details: [
      "System uses 3 independent oracle sources: Chainlink, Pyth, Uniswap V3 TWAP",
      "Median price aggregation requires 2/3 honest oracles (Byzantine tolerance)",
      "If one oracle gives bad price, other two dominate the result",
      "Staleness checks: Max age thresholds for each source",
      "Deviation limits: Max 30% deviation accepted from consensus"
    ]
  },
  {
    id: "reorg",
    title: "Chain Reorganization (Reorg)",
    description: "Attacker tries to deep-reorg the chain to reverse settlement",
    attack: "Attacker attempts a deep chain reorganization to reverse settled orders and create double-spends.",
    protection: "Safety Buffer + Idempotent Execution",
    result: "protected",
    details: [
      "Safety buffer: Settlements only finalized after 64 blocks (Ethereum standard)",
      "Within safety buffer window, transactions vulnerable - protected by monitoring",
      "After safety buffer: Settlement is immutable, deep reorg detected",
      "Nullifier tracking prevents replays even if reorg happens",
      "Parent hash verification ensures ancestry integrity across reorgs"
    ]
  },
  {
    id: "double-settle",
    title: "Double Settlement Claim",
    description: "Attacker tries to claim settlement results twice",
    attack: "Attacker attempts to claim settlement results in both original and forked chain.",
    protection: "Idempotence Verification",
    result: "prevented",
    details: [
      "Each settlement claim marked with unique nullifier",
      "Smart contract tracks all consumed nullifiers",
      "Duplicate claim with same nullifier is rejected onchain",
      "Storage-level protection: Claim flag prevents re-execution",
      "Even across reorgs, idempotence is enforced"
    ]
  },
  {
    id: "flash-loan",
    title: "Flash Loan Price Manipulation",
    description: "Attacker uses flash loans to temporarily spike prices",
    attack: "Attacker borrows massive amounts in a flash loan, manipulates DEX price, triggers settlement.",
    protection: "TWAP Oracles + Multi-Source Aggregation",
    result: "protected",
    details: [
      "Uniswap V3 TWAP uses 30-minute time-weighted average price",
      "Flash loans only affect instantaneous prices, not time-weighted averages",
      "Even if one source is manipulated, Byzantine consensus protects result",
      "Chainlink and Pyth prices are external and cannot be flash-loaned",
      "Deviation checks reject if manipulation is detected"
    ]
  }
];

export default function SecurityDemoPage() {
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

          <h1 className="text-3xl font-bold text-slate-900">Security Demonstrations</h1>
          <p className="mt-2 text-slate-600">
            Explore how ClearSettle protects against common blockchain attacks through simulated scenarios
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Info Card */}
        <div className="mb-8 rounded-lg border-2 border-blue-300 bg-blue-50 p-6">
          <h2 className="text-lg font-semibold text-blue-900">About These Demonstrations</h2>
          <p className="mt-2 text-sm text-blue-800">
            These are simulated attack scenarios showing how ClearSettle architecture prevents or mitigates common DeFi attacks.
            None of these attacks can succeed against our protocol due to its formal invariant verification and multi-layered defenses.
          </p>
        </div>

        {/* Defense Summary Grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-600">Front-Running</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">✓ Blocked</p>
            <p className="mt-2 text-xs text-slate-500">Commit-reveal hides orders</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-600">Sandwich Attacks</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">✓ Prevented</p>
            <p className="mt-2 text-xs text-slate-500">Uniform clearing price</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-600">Griefing</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">✓ Protected</p>
            <p className="mt-2 text-xs text-slate-500">Bond slashing mechanism</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-slate-600">Replay</p>
            <p className="mt-2 text-2xl font-bold text-emerald-600">✓ Prevented</p>
            <p className="mt-2 text-xs text-slate-500">Single execution invariant</p>
          </div>
        </div>

        {/* Scenarios Grid */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-900">Attack Scenarios</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {scenarios.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} />
            ))}
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-12 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Formal Verification</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <p>
              ClearSettle implements <strong>5 formally verified invariants</strong> that guarantee protocol safety:
            </p>
            <ul className="space-y-2 ml-4">
              <li className="flex gap-2">
                <span className="font-bold text-emerald-600">1.</span>
                <span><strong>Solvency:</strong> Contract balance ≥ Total user claims (no bank runs)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-emerald-600">2.</span>
                <span><strong>Conservation:</strong> Deposits = Withdrawals + Balance (no inflation bugs)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-emerald-600">3.</span>
                <span><strong>Monotonicity:</strong> Block times always increase (no time-travel attacks)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-emerald-600">4.</span>
                <span><strong>Single Execution:</strong> Each order executes at most once (no replays)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-emerald-600">5.</span>
                <span><strong>Valid Transitions:</strong> Only valid state machine transitions allowed</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-600">
              These invariants are checked at runtime on every critical operation using Hoare logic verification.
            </p>
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
