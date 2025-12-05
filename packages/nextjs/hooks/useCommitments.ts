import { useEffect, useState } from "react";

export interface CommitmentRecord {
  id: string;
  hash: string;
  amount: string;
  side: "BUY" | "SELL";
  price: string;
  salt: string;
  timestamp: number;
  revealed: boolean;
  settlementPrice?: string;
}

const STORAGE_KEY = "clearsettle_commitments";

// Use a custom event to sync state across tabs
const createStorageEvent = () => {
  const event = new CustomEvent("commitments-updated", {
    detail: { timestamp: Date.now() },
  });
  window.dispatchEvent(event);
};

export function useCommitments() {
  const [commitments, setCommitments] = useState<CommitmentRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setCommitments(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse commitments:", e);
      }
    }
    setIsLoaded(true);
  }, []);

  // Listen for storage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setCommitments(JSON.parse(e.newValue));
        } catch (e) {
          console.error("Failed to parse commitments:", e);
        }
      }
    };

    const handleCustomEvent = () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          setCommitments(JSON.parse(saved));
        } catch (e) {
          console.error("Failed to parse commitments:", e);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("commitments-updated", handleCustomEvent);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("commitments-updated", handleCustomEvent);
    };
  }, []);

  const addCommitment = (commitment: Omit<CommitmentRecord, "id">) => {
    const newCommitment: CommitmentRecord = {
      ...commitment,
      id: `${Date.now()}-${Math.random()}`,
    };
    const updated = [newCommitment, ...commitments];
    setCommitments(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    createStorageEvent();
    return newCommitment;
  };

  const updateCommitment = (id: string, updates: Partial<CommitmentRecord>) => {
    const updated = commitments.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );
    setCommitments(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    createStorageEvent();
  };

  const getCommitmentByHash = (hash: string) => {
    return commitments.find((c) => c.hash === hash);
  };

  return {
    commitments,
    isLoaded,
    addCommitment,
    updateCommitment,
    getCommitmentByHash,
  };
}
