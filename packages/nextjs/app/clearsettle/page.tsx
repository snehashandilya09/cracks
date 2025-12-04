"use client";

import { useState, useEffect } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { parseEther, formatEther, keccak256, encodePacked } from "viem";

/**
 * ClearSettle Protocol Dashboard
 * 
 * An Epoch-Based Batch Auction Settlement Protocol
 * 
 * Features:
 * ✓ Fair Ordering via Commit-Reveal
 * ✓ MEV Protection via Uniform Clearing Price
 * ✓ 5 Core Invariants Enforced
 * ✓ Attack-Resistant Design
 */

// Phase names for display
const PHASE_NAMES: { [key: number]: string } = {
  0: "UNINITIALIZED",
  1: "ACCEPTING COMMITS",
  2: "ACCEPTING REVEALS",
  3: "SETTLING",
  4: "SAFETY BUFFER",
  5: "FINALIZED",
  6: "VOID"
};

const PHASE_COLORS: { [key: number]: string } = {
  0: "badge-ghost",
  1: "badge-primary",
  2: "badge-secondary",
  3: "badge-accent",
  4: "badge-warning",
  5: "badge-success",
  6: "badge-error"
};

// Helper to mine blocks on local chain
const mineBlocks = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await fetch("http://localhost:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: Date.now() + i,
      }),
    });
  }
};

const ClearSettlePage: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  
  // Mining state
  const [isMining, setIsMining] = useState(false);
  
  // Order form state
  const [orderAmount, setOrderAmount] = useState("1");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderPrice, setOrderPrice] = useState("1");
  const [orderSalt, setOrderSalt] = useState("");
  const [commitmentHash, setCommitmentHash] = useState("");
  
  // Reveal form state
  const [revealAmount, setRevealAmount] = useState("1");
  const [revealSide, setRevealSide] = useState<"BUY" | "SELL">("BUY");
  const [revealPrice, setRevealPrice] = useState("1");
  const [revealSalt, setRevealSalt] = useState("");

  // Contract reads - with watch for auto-refresh
  const { data: currentEpoch, refetch: refetchEpoch } = useScaffoldReadContract({
    contractName: "ClearSettle",
    functionName: "getCurrentEpoch",
  });

  const { data: currentPhase, refetch: refetchPhase } = useScaffoldReadContract({
    contractName: "ClearSettle",
    functionName: "getCurrentPhase",
  });

  const { data: epochData, refetch: refetchEpochData } = useScaffoldReadContract({
    contractName: "ClearSettle",
    functionName: "getEpochData",
    args: [currentEpoch || 1n],
  });

  const { data: userCommitment, refetch: refetchCommitment } = useScaffoldReadContract({
    contractName: "ClearSettle",
    functionName: "getCommitment",
    args: [currentEpoch || 1n, connectedAddress],
  });

  const { data: stats } = useScaffoldReadContract({
    contractName: "ClearSettle",
    functionName: "getStats",
  });

  // Contract writes
  const { writeContractAsync: commitOrder, isPending: isCommitting } = useScaffoldWriteContract({
    contractName: "ClearSettle",
  });

  const { writeContractAsync: revealOrder, isPending: isRevealing } = useScaffoldWriteContract({
    contractName: "ClearSettle",
  });

  const { writeContractAsync: settleEpoch, isPending: isSettling } = useScaffoldWriteContract({
    contractName: "ClearSettle",
  });

  const { writeContractAsync: forceAdvanceEpoch, isPending: isAdvancing } = useScaffoldWriteContract({
    contractName: "ClearSettle",
  });

  const { writeContractAsync: resetForDemo, isPending: isResetting } = useScaffoldWriteContract({
    contractName: "ClearSettle",
  });

  // Current block number state
  const [currentBlock, setCurrentBlock] = useState<bigint>(0n);

  // Fetch current block number and refresh data
  useEffect(() => {
    const fetchBlock = async () => {
      try {
        const response = await fetch("http://localhost:8545", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: [],
            id: 1,
          }),
        });
        const data = await response.json();
        setCurrentBlock(BigInt(data.result));
      } catch (e) {
        console.error("Failed to fetch block:", e);
      }
    };
    
    fetchBlock();
    const interval = setInterval(fetchBlock, 2000);
    return () => clearInterval(interval);
  }, []);

  // Calculate real phase from block numbers
  const calculatedPhase = (() => {
    if (!epochData) return Number(currentPhase) || 0;
    const block = currentBlock;
    const storedPhase = Number(currentPhase) || 0;
    
    if (storedPhase >= 5) return storedPhase; // FINALIZED/VOID
    if (storedPhase === 4) return 4; // SAFETY_BUFFER
    if (block <= epochData.commitEndBlock) return 1; // ACCEPTING_COMMITS
    if (block <= epochData.revealEndBlock) return 2; // ACCEPTING_REVEALS
    return 3; // SETTLING
  })();

  // Generate random salt on mount
  useEffect(() => {
    if (!connectedAddress) return;
    const randomSalt = keccak256(encodePacked(
      ["uint256", "uint256", "address"],
      [BigInt(Date.now()), BigInt(Math.random() * 1e18), connectedAddress]
    ));
    setOrderSalt(randomSalt);
  }, [connectedAddress]);

  // Calculate commitment hash when order params change
  useEffect(() => {
    if (connectedAddress && orderSalt) {
      try {
        const hash = keccak256(encodePacked(
          ["uint256", "uint8", "uint256", "bytes32", "address"],
          [
            parseEther(orderAmount || "0"),
            orderSide === "BUY" ? 0 : 1,
            parseEther(orderPrice || "0"),
            orderSalt as `0x${string}`,
            connectedAddress
          ]
        ));
        setCommitmentHash(hash);
      } catch (e) {
        setCommitmentHash("");
      }
    }
  }, [orderAmount, orderSide, orderPrice, orderSalt, connectedAddress]);

  // Refetch all data
  const refetchAll = () => {
    refetchEpoch();
    refetchPhase();
    refetchEpochData();
    refetchCommitment();
  };

  // Handle commit
  const handleCommit = async () => {
    if (!commitmentHash) return;
    
    // Store salt locally for reveal
    localStorage.setItem(`clearsettle_salt_${currentEpoch}`, JSON.stringify({
      salt: orderSalt,
      amount: orderAmount,
      side: orderSide,
      price: orderPrice
    }));

    await commitOrder({
      functionName: "commitOrder",
      args: [commitmentHash as `0x${string}`],
      value: parseEther("0.01"), // MIN_BOND
    });
    
    // Refresh data after transaction
    setTimeout(refetchAll, 1000);
  };

  // Handle reveal
  const handleReveal = async () => {
    await revealOrder({
      functionName: "revealOrder",
      args: [
        parseEther(revealAmount),
        revealSide === "BUY" ? 0 : 1,
        parseEther(revealPrice),
        revealSalt as `0x${string}`
      ],
    });
    
    // Refresh data after transaction
    setTimeout(refetchAll, 1000);
  };

  // Handle settle
  const handleSettle = async () => {
    await settleEpoch({
      functionName: "settleEpoch",
    });
    
    // Refresh data after transaction
    setTimeout(refetchAll, 1000);
  };

  // Handle force advance to new epoch
  const handleForceAdvance = async () => {
    await forceAdvanceEpoch({
      functionName: "forceAdvanceEpoch",
    });
    
    // Refresh data after transaction
    setTimeout(refetchAll, 1000);
  };

  // Handle advance to next phase (mine blocks)
  const handleAdvancePhase = async () => {
    setIsMining(true);
    try {
      await mineBlocks(61); // Mine 61 blocks to advance phase
      // Refresh data after mining
      setTimeout(refetchAll, 500);
    } catch (e) {
      console.error("Mining failed:", e);
    }
    setIsMining(false);
  };

  // Load saved order for reveal
  const loadSavedOrder = () => {
    const saved = localStorage.getItem(`clearsettle_salt_${currentEpoch}`);
    if (saved) {
      const data = JSON.parse(saved);
      setRevealSalt(data.salt);
      setRevealAmount(data.amount);
      setRevealSide(data.side);
      setRevealPrice(data.price);
    }
  };

  // Handle reset for demo
  const handleResetDemo = async () => {
    await resetForDemo({
      functionName: "resetForDemo",
    });
    setTimeout(refetchAll, 1000);
  };

  // Use calculated phase for UI display
  const phaseNumber = calculatedPhase;

  // Check if emergency mode
  const isEmergencyMode = stats && stats[3] === true;

  return (
    <div className="flex flex-col items-center py-10 px-4">
      {/* Emergency Mode Banner */}
      {isEmergencyMode && (
        <div className="w-full max-w-4xl mb-4">
          <div className="alert alert-error">
            <span>🚨 Emergency Mode Active - Click "Reset Demo" to continue</span>
            <button
              className={`btn btn-sm btn-warning ${isResetting ? "loading" : ""}`}
              onClick={handleResetDemo}
              disabled={isResetting}
            >
              {isResetting ? "Resetting..." : "🔄 Reset Demo"}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">🔐 ClearSettle Protocol</h1>
        <p className="text-lg text-gray-500">Epoch-Based Batch Auction Settlement</p>
        <p className="text-sm text-gray-400 mt-1">MEV-Resistant • Fair Ordering • Adversarial-Resilient</p>
      </div>

      {/* Status Banner */}
      <div className="w-full max-w-4xl bg-base-200 rounded-2xl p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="stat">
            <div className="stat-title">Current Epoch</div>
            <div className="stat-value text-primary">{currentEpoch?.toString() || "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-title">Phase</div>
            <div className="stat-value">
              <span className={`badge ${PHASE_COLORS[phaseNumber]} text-sm`}>
                {PHASE_NAMES[phaseNumber] || "Unknown"}
              </span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-title">Buy Volume</div>
            <div className="stat-value text-success text-2xl">
              {epochData ? formatEther(epochData.totalBuyVolume) : "0"} ETH
            </div>
          </div>
          <div className="stat">
            <div className="stat-title">Sell Volume</div>
            <div className="stat-value text-error text-2xl">
              {epochData ? formatEther(epochData.totalSellVolume) : "0"} ETH
            </div>
          </div>
        </div>

        {/* Block Progress */}
        {epochData && (
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span>Current Block: <strong>{currentBlock.toString()}</strong></span>
              <span>
                Start: {epochData.startBlock.toString()} | 
                Commit End: {epochData.commitEndBlock.toString()} | 
                Reveal End: {epochData.revealEndBlock.toString()}
              </span>
            </div>
            <progress 
              className="progress progress-primary w-full" 
              value={phaseNumber} 
              max={5}
            />
          </div>
        )}

        {/* Advance Phase Button */}
        <div className="mt-4 flex justify-center">
          <button
            className={`btn btn-outline btn-info ${isMining ? "loading" : ""}`}
            onClick={handleAdvancePhase}
            disabled={isMining || phaseNumber >= 5}
          >
            {isMining ? "Mining blocks..." : "⏩ Advance to Next Phase (Demo)"}
          </button>
          <span className="ml-3 text-xs text-gray-400 self-center">
            Simulates blockchain time passing
          </span>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Commit Order Card */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">
              📝 1. Commit Order
              {phaseNumber === 1 && <span className="badge badge-success">Active</span>}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Hide your order details using a cryptographic commitment
            </p>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount (ETH)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={orderAmount}
                onChange={(e) => setOrderAmount(e.target.value)}
                className="input input-bordered"
                placeholder="1.0"
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Side</span>
              </label>
              <div className="btn-group w-full">
                <button 
                  className={`btn flex-1 ${orderSide === "BUY" ? "btn-success" : "btn-ghost"}`}
                  onClick={() => setOrderSide("BUY")}
                >
                  🟢 BUY
                </button>
                <button 
                  className={`btn flex-1 ${orderSide === "SELL" ? "btn-error" : "btn-ghost"}`}
                  onClick={() => setOrderSide("SELL")}
                >
                  🔴 SELL
                </button>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Limit Price (ETH)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={orderPrice}
                onChange={(e) => setOrderPrice(e.target.value)}
                className="input input-bordered"
                placeholder="1.0"
              />
            </div>

            {commitmentHash && (
              <div className="alert alert-info mt-4">
                <div>
                  <span className="font-bold">Commitment Hash:</span>
                  <p className="text-xs break-all mt-1">{commitmentHash}</p>
                </div>
              </div>
            )}

            <div className="card-actions justify-end mt-4">
              <button
                className={`btn btn-primary ${isCommitting ? "loading" : ""}`}
                onClick={handleCommit}
                disabled={phaseNumber !== 1 || isCommitting || !connectedAddress}
              >
                {isCommitting ? "Committing..." : "Commit (0.01 ETH Bond)"}
              </button>
            </div>

            {userCommitment && userCommitment.hash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
              <div className="alert alert-success mt-2">
                ✓ You have committed to this epoch
              </div>
            )}
          </div>
        </div>

        {/* Reveal Order Card */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">
              🔓 2. Reveal Order
              {phaseNumber === 2 && <span className="badge badge-success">Active</span>}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Reveal your committed order to participate in settlement
            </p>

            <button 
              className="btn btn-outline btn-sm mb-4"
              onClick={loadSavedOrder}
            >
              📂 Load Saved Order
            </button>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount (ETH)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={revealAmount}
                onChange={(e) => setRevealAmount(e.target.value)}
                className="input input-bordered"
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Side</span>
              </label>
              <div className="btn-group w-full">
                <button 
                  className={`btn flex-1 ${revealSide === "BUY" ? "btn-success" : "btn-ghost"}`}
                  onClick={() => setRevealSide("BUY")}
                >
                  🟢 BUY
                </button>
                <button 
                  className={`btn flex-1 ${revealSide === "SELL" ? "btn-error" : "btn-ghost"}`}
                  onClick={() => setRevealSide("SELL")}
                >
                  🔴 SELL
                </button>
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Limit Price (ETH)</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={revealPrice}
                onChange={(e) => setRevealPrice(e.target.value)}
                className="input input-bordered"
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Salt (from commit)</span>
              </label>
              <input
                type="text"
                value={revealSalt}
                onChange={(e) => setRevealSalt(e.target.value)}
                className="input input-bordered text-xs"
                placeholder="0x..."
              />
            </div>

            <div className="card-actions justify-end mt-4">
              <button
                className={`btn btn-secondary ${isRevealing ? "loading" : ""}`}
                onClick={handleReveal}
                disabled={isRevealing || !connectedAddress || !revealSalt}
              >
                {isRevealing ? "Revealing..." : "Reveal Order"}
              </button>
            </div>

            {userCommitment && userCommitment.revealed && (
              <div className="alert alert-success mt-2">
                ✓ Order revealed successfully
              </div>
            )}
          </div>
        </div>

        {/* Settlement Card */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">
              ⚖️ 3. Settlement
              {phaseNumber === 3 && <span className="badge badge-success">Active</span>}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Trigger batch settlement at uniform clearing price
            </p>

            {epochData && epochData.clearingPrice > 0n && (
              <div className="stats stats-vertical shadow mb-4">
                <div className="stat">
                  <div className="stat-title">Clearing Price</div>
                  <div className="stat-value text-primary">
                    {formatEther(epochData.clearingPrice)} ETH
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-title">Matched Volume</div>
                  <div className="stat-value text-secondary">
                    {formatEther(epochData.matchedVolume)} ETH
                  </div>
                </div>
              </div>
            )}

            <div className="card-actions justify-end">
              <button
                className={`btn btn-accent ${isSettling ? "loading" : ""}`}
                onClick={handleSettle}
                disabled={isSettling}
              >
                {isSettling ? "Settling..." : "Trigger Settlement"}
              </button>
            </div>

            {/* Start New Epoch Button - for demo purposes */}
            {(phaseNumber >= 4) && (
              <div className="mt-4 pt-4 border-t border-base-300">
                <p className="text-sm text-gray-500 mb-2">
                  Current epoch completed. Start a new one to demo again:
                </p>
                <button
                  className={`btn btn-primary w-full ${isAdvancing ? "loading" : ""}`}
                  onClick={handleForceAdvance}
                  disabled={isAdvancing}
                >
                  {isAdvancing ? "Starting..." : "🔄 Start New Epoch"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Protocol Stats Card */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">📊 Protocol Stats</h2>
            
            {stats && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Total Deposits:</span>
                  <span className="font-mono">{formatEther(stats[0])} ETH</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Withdrawals:</span>
                  <span className="font-mono">{formatEther(stats[1])} ETH</span>
                </div>
                <div className="flex justify-between">
                  <span>Treasury Balance:</span>
                  <span className="font-mono">{formatEther(stats[2])} ETH</span>
                </div>
                <div className="flex justify-between">
                  <span>Emergency Mode:</span>
                  <span className={stats[3] ? "text-error" : "text-success"}>
                    {stats[3] ? "⚠️ Active" : "✓ Normal"}
                  </span>
                </div>
              </div>
            )}

            <div className="divider">Invariants</div>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-xs">✓</span>
                <span>Solvency: balance ≥ claims</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-xs">✓</span>
                <span>Conservation: deposits = withdrawals + balance</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-xs">✓</span>
                <span>Monotonicity: timestamps always increase</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-xs">✓</span>
                <span>Single Execution: orders execute once</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-success badge-xs">✓</span>
                <span>Valid Transitions: phases follow state machine</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Section */}
      <div className="w-full max-w-4xl mt-8">
        <div className="collapse collapse-arrow bg-base-200">
          <input type="checkbox" />
          <div className="collapse-title text-xl font-medium">
            🛡️ How ClearSettle Prevents MEV Attacks
          </div>
          <div className="collapse-content">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              <div className="card bg-base-100">
                <div className="card-body">
                  <h3 className="font-bold">Front-Running Prevention</h3>
                  <p className="text-sm">
                    Order details (amount, side, price) are hidden by cryptographic 
                    commitment until reveal phase. Attackers cannot see what to front-run.
                  </p>
                </div>
              </div>
              <div className="card bg-base-100">
                <div className="card-body">
                  <h3 className="font-bold">Sandwich Attack Prevention</h3>
                  <p className="text-sm">
                    All orders execute at a uniform clearing price. There is no 
                    sequential execution advantage - attackers cannot profit from timing.
                  </p>
                </div>
              </div>
              <div className="card bg-base-100">
                <div className="card-body">
                  <h3 className="font-bold">Griefing Prevention</h3>
                  <p className="text-sm">
                    Committers who don't reveal have their bonds slashed. This makes 
                    denial-of-service attacks economically irrational.
                  </p>
                </div>
              </div>
              <div className="card bg-base-100">
                <div className="card-body">
                  <h3 className="font-bold">Replay Prevention</h3>
                  <p className="text-sm">
                    Each order can only be revealed once (single execution invariant).
                    Commitment hashes include sender address preventing cross-user replay.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClearSettlePage;
