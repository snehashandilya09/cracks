"use client";

import { useAccount, useBalance } from "wagmi";
import { Address } from "viem";

interface HeaderProps {
  currentBlock: bigint;
  epochId: bigint;
}

export function Header({ currentBlock, epochId }: HeaderProps) {
  const { address } = useAccount();
  const { data: balance } = useBalance({ address });

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">ClearSettle</h1>
            <p className="mt-1 text-sm text-slate-500">Fair & Safe Batch Settlement Protocol</p>
          </div>

          <div className="flex gap-6">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Network</p>
              <p className="mt-1 text-sm font-medium text-slate-900">Sepolia Testnet</p>
            </div>

            <div className="border-l border-slate-200 pl-6 text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Block</p>
              <p className="mt-1 text-sm font-medium text-slate-900">#{currentBlock.toString()}</p>
            </div>

            <div className="border-l border-slate-200 pl-6 text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Epoch</p>
              <p className="mt-1 text-sm font-medium text-slate-900">#{epochId.toString()}</p>
            </div>

            <div className="border-l border-slate-200 pl-6 text-right">
              <p className="text-xs font-semibold uppercase text-slate-500">Wallet</p>
              {address ? (
                <>
                  <p className="mt-1 text-sm font-medium text-slate-900">{address.slice(0, 6)}...{address.slice(-4)}</p>
                  <p className="mt-1 text-xs text-slate-500">{balance?.formatted.slice(0, 6)} ETH</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Not Connected</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
