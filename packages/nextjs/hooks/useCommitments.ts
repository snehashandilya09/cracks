"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useOrderEvents } from "./useOrderEvents";

const SALT_STORAGE_KEY = "clearsettle_salts";

export interface CommitmentRecord {
  id: string;
  hash: string;
  amount?: string;
  side?: "BUY" | "SELL";
  price?: string;
  salt?: string; // Only stored locally (SECRET!)
  epochId: bigint;
  revealed: boolean;
  timestamp: number;
}

export function useCommitments() {
  const { address } = useAccount();
  const { commitments: onChainCommitments } = useOrderEvents(address);
  const [salts, setSalts] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<Record<string, { amount: string; side: "BUY" | "SELL"; price: string }>>({});

  // Load salts and metadata from localStorage
  useEffect(() => {
    const savedSalts = localStorage.getItem(SALT_STORAGE_KEY);
    if (savedSalts) {
      try {
        setSalts(JSON.parse(savedSalts));
      } catch (e) {
        console.error("Failed to parse salts:", e);
      }
    }

    const savedMetadata = localStorage.getItem("clearsettle_metadata");
    if (savedMetadata) {
      try {
        setMetadata(JSON.parse(savedMetadata));
      } catch (e) {
        console.error("Failed to parse metadata:", e);
      }
    }
  }, []);

  // Save salt (SECRET - never send to blockchain!)
  const saveSalt = (hash: string, salt: string, amount: string, side: "BUY" | "SELL", price: string) => {
    const updatedSalts = { ...salts, [hash]: salt };
    setSalts(updatedSalts);
    localStorage.setItem(SALT_STORAGE_KEY, JSON.stringify(updatedSalts));

    const updatedMetadata = { ...metadata, [hash]: { amount, side, price } };
    setMetadata(updatedMetadata);
    localStorage.setItem("clearsettle_metadata", JSON.stringify(updatedMetadata));
  };

  // Get salt for a commitment
  const getSalt = (hash: string) => salts[hash];

  // Merge on-chain data with local salts and metadata
  const commitments: CommitmentRecord[] = onChainCommitments.map((c) => ({
    id: c.hash,
    hash: c.hash,
    amount: c.amount || metadata[c.hash]?.amount,
    side: c.side || metadata[c.hash]?.side,
    price: metadata[c.hash]?.price,
    salt: salts[c.hash], // Only available locally
    epochId: c.epochId,
    revealed: c.revealed,
    timestamp: Number(c.blockNumber) * 12, // Convert block number to approximate timestamp
  }));

  return {
    commitments,
    saveSalt,
    getSalt,
  };
}
