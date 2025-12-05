"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

const chainId = 31337; // localhost
const CONTRACT = deployedContracts[chainId]?.ClearSettle;

export function useCommitOrder() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const commitOrder = async (commitmentHash: `0x${string}`) => {
    if (!CONTRACT) {
      throw new Error("Contract not deployed on this network");
    }

    return writeContract({
      address: CONTRACT.address as `0x${string}`,
      abi: CONTRACT.abi,
      functionName: "commitOrder",
      args: [commitmentHash],
      value: parseEther("0.01"), // Bond requirement
    });
  };

  return {
    commitOrder,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash, // Transaction hash for block explorer
  };
}
