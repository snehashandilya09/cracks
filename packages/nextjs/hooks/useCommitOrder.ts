"use client";

import { parseEther } from "viem";
import { useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";

export function useCommitOrder() {
  const chainId = useChainId();
  const CONTRACT = deployedContracts[chainId as keyof typeof deployedContracts]?.ClearSettle;

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
