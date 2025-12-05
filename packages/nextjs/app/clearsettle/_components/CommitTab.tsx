"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { keccak256, encodePacked } from "viem";
import toast from "react-hot-toast";
import { useCommitments, type CommitmentRecord } from "../../../hooks/useCommitments";
import { useCommitOrder } from "../../../hooks/useCommitOrder";

export function CommitTab({ currentPhase }: { currentPhase: string | null }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [limitPrice, setLimitPrice] = useState("");
  const [salt, setSalt] = useState("");
  const [commitmentHash, setCommitmentHash] = useState("");

  const { commitments, saveSalt } = useCommitments();
  const { commitOrder, isPending, isConfirming, isSuccess, error, hash } = useCommitOrder();

  // Calculate hash when inputs change
  useEffect(() => {
    if (!amount || !limitPrice || !salt || !address) {
      setCommitmentHash("");
      return;
    }

    try {
      const sideValue = side === "BUY" ? 0 : 1;
      // Must match contract: keccak256(abi.encodePacked(amount, side, limitPrice, salt, msg.sender))
      // Side is OrderSide enum which is uint8 in Solidity
      const hash = keccak256(
        encodePacked(
          ["uint256", "uint8", "uint256", "bytes32", "address"],
          [
            BigInt(Math.floor(parseFloat(amount) * 1e18)),
            sideValue,
            BigInt(Math.floor(parseFloat(limitPrice) * 1e18)),
            salt as `0x${string}`,
            address as `0x${string}`,
          ]
        )
      );
      setCommitmentHash(hash);
    } catch (e) {
      setCommitmentHash("");
    }
  }, [amount, side, limitPrice, salt, address]);

  const generateSalt = () => {
    const randomBytes = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")
    ).join("");
    setSalt(`0x${randomBytes}`);
  };

  const handleCommit = async () => {
    if (!commitmentHash) {
      toast.error("Invalid order data");
      return;
    }

    if (currentPhase !== "ACCEPTING_COMMITS") {
      toast.error("Can only commit during commit phase");
      return;
    }

    if (!address) {
      toast.error("Wallet not connected");
      return;
    }

    try {
      // Call blockchain!
      await commitOrder(commitmentHash as `0x${string}`);

      // Save salt and metadata locally (SECRET - never send to chain)
      saveSalt(commitmentHash, salt, amount, side, limitPrice);

      toast.success("Transaction submitted! Waiting for confirmation...");

      // Reset form
      setAmount("");
      setLimitPrice("");
      setSalt("");
    } catch (e: any) {
      console.error("Commit error:", e);
      toast.error(`Commit failed: ${e.message || "Unknown error"}`);
    }
  };

  // Success notification
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success(`Order confirmed on blockchain! Tx: ${hash.slice(0, 10)}...`);
    }
  }, [isSuccess, hash]);

  // Error notification
  useEffect(() => {
    if (error) {
      toast.error(`Transaction failed: ${error.message}`);
    }
  }, [error]);

  const canCommit = amount && limitPrice && salt && currentPhase === "ACCEPTING_COMMITS" && !isPending && !isConfirming;

  return (
    <div className="space-y-6">
      {/* Order Form */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-slate-900">Create Order</h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Amount (ETH)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1.5"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Side */}
          <div>
            <label className="block text-sm font-medium text-slate-700">Order Side</label>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => setSide("BUY")}
                className={`flex-1 rounded-lg px-3 py-2 font-medium transition-colors ${
                  side === "BUY" ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-700 hover:border-emerald-500"
                }`}
              >
                BUY
              </button>
              <button
                onClick={() => setSide("SELL")}
                className={`flex-1 rounded-lg px-3 py-2 font-medium transition-colors ${
                  side === "SELL" ? "bg-rose-500 text-white" : "border border-slate-300 text-slate-700 hover:border-rose-500"
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          {/* Limit Price */}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700">Limit Price (USD)</label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="2500"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Salt */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700">Salt (Privacy Key)</label>
              <button
                onClick={generateSalt}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Generate Random
              </button>
            </div>
            <input
              type="text"
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
              placeholder="Auto-generated salt for privacy"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Hash Preview */}
        {commitmentHash && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase text-slate-600">Commitment Hash</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-700">{commitmentHash}</p>
            <p className="mt-2 text-xs text-slate-500">
              ✓ Your order is hidden with this hash. No one can see the details until reveal phase.
            </p>
          </div>
        )}

        {/* Bond Info */}
        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <span className="font-semibold">Bond Required:</span> 0.01 ETH (anti-griefing protection)
        </div>

        {/* Submit Button */}
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className={`mt-4 w-full rounded-lg px-4 py-3 font-semibold text-white transition-colors ${
            canCommit ? "bg-emerald-600 hover:bg-emerald-700 cursor-pointer" : "bg-slate-400 cursor-not-allowed opacity-50"
          }`}
        >
          {isPending || isConfirming
            ? "Committing to blockchain..."
            : currentPhase === "ACCEPTING_COMMITS"
            ? "Commit Order (0.01 ETH bond)"
            : `Can only commit during commit phase (Current: ${currentPhase})`}
        </button>

        {/* Transaction Link */}
        {hash && (
          <div className="mt-2 text-xs text-center">
            <a
              href={`/blockexplorer/transaction/${hash}`}
              target="_blank"
              className="text-emerald-600 hover:underline"
            >
              View transaction →
            </a>
          </div>
        )}
      </div>

      {/* Committed Orders */}
      {commitments.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-slate-900">Your Commitments</h3>
          <div className="mt-4 space-y-2">
            {commitments.map((c: CommitmentRecord) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      c.side === "BUY" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}>
                      {c.side}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{c.amount} ETH @ ${c.price}</p>
                      <p className="text-xs text-slate-500">{new Date(c.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold ${c.revealed ? "text-emerald-600" : "text-amber-600"}`}>
                    {c.revealed ? "✓ Revealed" : "⏳ Committed"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
