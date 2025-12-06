"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

const STORAGE_KEY = "clearsettle_orders";

export interface CommitmentRecord {
  id: string;
  hash: string;
  amount: string;
  side: "BUY" | "SELL";
  price: string;
  salt: string; // SECRET - stored locally only
  epochId: bigint;
  revealed: boolean;
  commitBlock: bigint;
  bondAmount: bigint;
  slashed: boolean;
}

interface LocalOrderData {
  hash: string;
  amount: string;
  side: "BUY" | "SELL";
  price: string;
  salt: string;
  epochId: string; // Stored as string in localStorage
  createdAt: number;
}

export function useCommitments() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const CONTRACT = deployedContracts[chainId as keyof typeof deployedContracts]?.ClearSettle;

  const [commitments, setCommitments] = useState<CommitmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load orders from localStorage and verify against blockchain
  useEffect(() => {
    if (!address || !publicClient || !CONTRACT) return;

    const loadAndVerifyOrders = async () => {
      setIsLoading(true);

      try {
        // Get locally stored orders
        const storageKey = `${STORAGE_KEY}_${address.toLowerCase()}`;
        const savedOrders = localStorage.getItem(storageKey);
        const localOrders: LocalOrderData[] = savedOrders ? JSON.parse(savedOrders) : [];

        if (localOrders.length === 0) {
          setCommitments([]);
          setIsLoading(false);
          return;
        }

        // Verify each order against the blockchain
        const verifiedCommitments: CommitmentRecord[] = [];

        for (const order of localOrders) {
          try {
            // Read commitment directly from contract
            const commitment = (await publicClient.readContract({
              address: CONTRACT.address as `0x${string}`,
              abi: CONTRACT.abi,
              functionName: "getCommitment",
              args: [BigInt(order.epochId), address],
            })) as {
              hash: `0x${string}`;
              commitBlock: number | bigint;
              bondAmount: bigint;
              revealed: boolean;
              slashed: boolean;
            };

            // Only include if commitment exists on chain (hash is not zero)
            if (
              commitment.hash &&
              commitment.hash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
            ) {
              verifiedCommitments.push({
                id: order.hash,
                hash: commitment.hash,
                amount: order.amount,
                side: order.side,
                price: order.price,
                salt: order.salt,
                epochId: BigInt(order.epochId),
                revealed: commitment.revealed,
                commitBlock: BigInt(commitment.commitBlock),
                bondAmount: commitment.bondAmount,
                slashed: commitment.slashed,
              });
            }
          } catch (err) {
            console.warn(`Failed to verify commitment for epoch ${order.epochId}:`, err);
          }
        }

        setCommitments(verifiedCommitments);
      } catch (err) {
        console.error("Failed to load commitments:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadAndVerifyOrders();

    // Refresh every 15 seconds
    const interval = setInterval(loadAndVerifyOrders, 15000);
    return () => clearInterval(interval);
  }, [address, publicClient, CONTRACT]);

  // Save a new order locally (called after successful commit transaction)
  const saveOrder = (
    hash: string,
    salt: string,
    amount: string,
    side: "BUY" | "SELL",
    price: string,
    epochId: bigint,
  ) => {
    if (!address) return;

    const storageKey = `${STORAGE_KEY}_${address.toLowerCase()}`;
    const savedOrders = localStorage.getItem(storageKey);
    const orders: LocalOrderData[] = savedOrders ? JSON.parse(savedOrders) : [];

    // Check if order already exists
    const existingIndex = orders.findIndex(o => o.hash === hash);
    if (existingIndex >= 0) {
      // Update existing
      orders[existingIndex] = {
        hash,
        amount,
        side,
        price,
        salt,
        epochId: epochId.toString(),
        createdAt: Date.now(),
      };
    } else {
      // Add new
      orders.push({
        hash,
        amount,
        side,
        price,
        salt,
        epochId: epochId.toString(),
        createdAt: Date.now(),
      });
    }

    localStorage.setItem(storageKey, JSON.stringify(orders));

    // Immediately add to state for UI update
    setCommitments(prev => {
      const exists = prev.some(c => c.hash === hash);
      if (exists) return prev;

      return [
        ...prev,
        {
          id: hash,
          hash,
          amount,
          side,
          price,
          salt,
          epochId,
          revealed: false,
          commitBlock: 0n,
          bondAmount: 0n,
          slashed: false,
        },
      ];
    });
  };

  // Get salt for revealing an order
  const getSalt = (hash: string): string | undefined => {
    const commitment = commitments.find(c => c.hash === hash || c.id === hash);
    return commitment?.salt;
  };

  // Get order data for revealing
  const getOrderData = (hash: string) => {
    const commitment = commitments.find(c => c.hash === hash || c.id === hash);
    if (!commitment) return null;
    return {
      amount: commitment.amount,
      side: commitment.side,
      price: commitment.price,
      salt: commitment.salt,
    };
  };

  // Clean up old orders (from past epochs)
  const cleanupOldOrders = async () => {
    if (!address || !publicClient || !CONTRACT) return;

    try {
      const currentEpochId = (await publicClient.readContract({
        address: CONTRACT.address as `0x${string}`,
        abi: CONTRACT.abi,
        functionName: "getCurrentEpochId",
      })) as bigint;

      const storageKey = `${STORAGE_KEY}_${address.toLowerCase()}`;
      const savedOrders = localStorage.getItem(storageKey);
      const orders: LocalOrderData[] = savedOrders ? JSON.parse(savedOrders) : [];

      // Keep only orders from current or recent epochs
      const recentOrders = orders.filter(o => {
        const epochId = BigInt(o.epochId);
        return epochId >= currentEpochId - 5n; // Keep last 5 epochs
      });

      localStorage.setItem(storageKey, JSON.stringify(recentOrders));
    } catch (err) {
      console.error("Failed to cleanup old orders:", err);
    }
  };

  return {
    commitments,
    isLoading,
    saveOrder,
    getSalt,
    getOrderData,
    cleanupOldOrders,
  };
}
