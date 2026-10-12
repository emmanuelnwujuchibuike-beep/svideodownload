"use client";

import { ChevronRight, Coins, Lock, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";

import { useSubEarnings } from "@/features/sub/sub-withdraw";
import { usd } from "@/lib/creator/membership/engine";
import { haptic } from "@/lib/motion/haptics";

const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });

/**
 * Withdraw — from the AI credit dashboard (owner brief 2026-10-11: "replace
 * Explore AI tools with a Withdraw button").
 *
 * Two balances can be cashed out, and they are never mixed:
 *   · AI Credits (the withdrawable kind) — through the rewards withdrawal, with
 *     its rate, fee and the reward qualification;
 *   · SUB earnings — money paid by the member's own subscribers, out through
 *     Paystack less the SUB withdrawal fee.
 * Each row says what it holds; the figures come from the server.
 */
export function WithdrawChooser({ onClose, creditsLabel }: { onClose: () => void; creditsLabel: string | null }) {
  const { data, failed } = useSubEarnings();
  const [sub, setSub] = useState(false);
  const e = data?.earnings;
  const hasSub = !!e && e.ready && (e.lifetimeCents > 0 || e.availableCents > 0 || e.withdrawals.length > 0);

  if (sub) return <SubWithdrawSheet onClose={onClose} />;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Withdraw" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-t-[28px] bg-background p-4 sm:rounded-[28px]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[17px] font-bold">Withdraw</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-full transition active:bg-black/[0.06]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mb-3 text-[13px] text-muted-foreground">Choose what to cash out. Each balance has its own fee and rules.</p>
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
          <li>
            <Link href="/rewards#withdraw" prefetch={false} onClick={() => haptic("selection")} className="flex min-h-[64px] items-center gap-3 px-3.5 py-3 transition active:bg-black/[0.04]">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                <Coins className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold">AI Credits</span>
                <span className="block text-[12.5px] text-muted-foreground">{creditsLabel ? `${creditsLabel} withdrawable` : "Withdrawable credits"} · rewards approval, rate and fee apply · history</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
          <li>
            {hasSub ? (
              <button type="button" onClick={() => (haptic("selection"), setSub(true))} className="flex min-h-[64px] w-full items-center gap-3 px-3.5 py-3 text-left transition active:bg-black/[0.04]">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-700 dark:text-indigo-300">
                  <Lock className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">Private post earnings</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {usd(e!.availableCents)} available · {data!.rules.withdrawalFeePercent}% fee · paid through Paystack
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ) : (
              <div className="flex min-h-[64px] items-center gap-3 px-3.5 py-3">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-700 dark:text-indigo-300">
                  <Lock className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">Private post earnings</span>
                  <span className="block text-[12.5px] text-muted-foreground">{!data && !failed ? "Checking…" : "Money your subscribers pay you. Set up PRIVATE POSTS on your profile to start earning."}</span>
                </span>
              </div>
            )}
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
