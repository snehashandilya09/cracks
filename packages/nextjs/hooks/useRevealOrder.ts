"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

const chainId = 31337; // localhost
const CONTRACT = deployedContracts[chainId]?.ClearSettle;

export function useRevealOrder() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const revealOrder = async (
    amount: string,
    side: "BUY" | "SELL",
    limitPrice: string,
    salt: `0x${string}`
  ) => {
    if (!CONTRACT) {
      throw new Error("Contract not deployed on this network");
    }

    return writeContract({
      address: CONTRACT.address as `0x${string}`,
      abi: CONTRACT.abi,
      functionName: "revealOrder",
      args: [
        BigInt(Math.floor(parseFloat(amount) * 1e18)), // amount in wei
        side === "BUY" ? 0 : 1, // OrderSide enum: 0 = BUY, 1 = SELL
        BigInt(Math.floor(parseFloat(limitPrice) * 1e18)), // price in wei
        salt,
      ],
    });
  };

  return {
    revealOrder,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash,
  };
}
