"use client";

import { useState, useEffect } from "react";
import { useWatchContractEvent, usePublicClient } from "wagmi";
import type { Address } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

const chainId = 31337; // localhost
const CONTRACT = deployedContracts[chainId]?.ClearSettle;

export interface OnChainCommitment {
  hash: string;
  epochId: bigint;
  blockNumber: bigint;
  revealed: boolean;
  amount?: string;
  side?: "BUY" | "SELL";
  price?: string;
}

export function useOrderEvents(userAddress: Address | undefined) {
  const [commitments, setCommitments] = useState<OnChainCommitment[]>([]);
  const publicClient = usePublicClient();

  if (!CONTRACT) {
    console.warn("ClearSettle contract not found");
  }

  // Listen for OrderCommitted events
  useWatchContractEvent({
    address: CONTRACT?.address as `0x${string}`,
    abi: CONTRACT?.abi,
    eventName: "OrderCommitted",
    args: userAddress ? { trader: userAddress } : undefined,
    onLogs(logs) {
      logs.forEach((log: any) => {
        const { epochId, trader, commitmentHash } = log.args;

        setCommitments((prev) => {
          // Avoid duplicates
          if (prev.some((c) => c.hash === commitmentHash)) return prev;

          return [
            ...prev,
            {
              hash: commitmentHash as string,
              epochId: epochId as bigint,
              blockNumber: log.blockNumber,
              revealed: false,
            },
          ];
        });
      });
    },
  });

  // Listen for OrderRevealed events
  useWatchContractEvent({
    address: CONTRACT?.address as `0x${string}`,
    abi: CONTRACT?.abi,
    eventName: "OrderRevealed",
    args: userAddress ? { trader: userAddress } : undefined,
    onLogs(logs) {
      logs.forEach((log: any) => {
        const { epochId, trader, amount, side } = log.args;

        setCommitments((prev) =>
          prev.map((c) =>
            c.epochId === epochId
              ? {
                  ...c,
                  revealed: true,
                  amount: amount?.toString(),
                  side: side === 0 ? ("BUY" as const) : ("SELL" as const),
                }
              : c
          )
        );
      });
    },
  });

  // Fetch past events on mount
  useEffect(() => {
    if (!userAddress || !publicClient || !CONTRACT) return;

    const fetchPastEvents = async () => {
      try {
        // Get OrderCommitted events
        const committedLogs = await publicClient.getLogs({
          address: CONTRACT.address as `0x${string}`,
          event: {
            type: "event",
            name: "OrderCommitted",
            inputs: [
              { indexed: true, name: "epochId", type: "uint256" },
              { indexed: true, name: "trader", type: "address" },
              { indexed: false, name: "commitmentHash", type: "bytes32" },
            ],
          },
          args: { trader: userAddress },
          fromBlock: "earliest",
        });

        // Get OrderRevealed events
        const revealedLogs = await publicClient.getLogs({
          address: CONTRACT.address as `0x${string}`,
          event: {
            type: "event",
            name: "OrderRevealed",
            inputs: [
              { indexed: true, name: "epochId", type: "uint256" },
              { indexed: true, name: "trader", type: "address" },
              { indexed: false, name: "amount", type: "uint256" },
              { indexed: false, name: "side", type: "uint8" },
            ],
          },
          args: { trader: userAddress },
          fromBlock: "earliest",
        });

        // Build commitment map
        const commitmentMap = new Map<string, OnChainCommitment>();

        // Process committed events
        committedLogs.forEach((log: any) => {
          const { epochId, commitmentHash } = log.args;
          commitmentMap.set(commitmentHash, {
            hash: commitmentHash as string,
            epochId: epochId as bigint,
            blockNumber: log.blockNumber,
            revealed: false,
          });
        });

        // Update with revealed info
        revealedLogs.forEach((log: any) => {
          const { epochId, amount, side } = log.args;

          // Find matching commitment by epochId
          commitmentMap.forEach((commitment, hash) => {
            if (commitment.epochId === epochId) {
              commitmentMap.set(hash, {
                ...commitment,
                revealed: true,
                amount: amount?.toString(),
                side: side === 0 ? "BUY" : "SELL",
              });
            }
          });
        });

        setCommitments(Array.from(commitmentMap.values()));
      } catch (e) {
        console.error("Failed to fetch past events:", e);
      }
    };

    fetchPastEvents();
  }, [userAddress, publicClient]);

  return { commitments };
}
