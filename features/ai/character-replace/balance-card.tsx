"use client";

import { Plus, Wallet, X } from "lucide-react";

import { AnimatedAmount } from "@/features/ai/animated-amount";
import { HIDDEN_AMOUNT, useBalanceHidden } from "@/lib/ai/character-replace/balance-privacy";
import type { CharacterReplaceBalance } from "@/lib/ai/character-replace/types";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE BALANCE — the figure, and the way to add to it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §8):
 *
 *     Character Replace Balance
 *     ₦2,500
 *     [Recharge]
 *
 * That, and nothing else on the card. The figure counts up when it changes
 * (`AnimatedAmount`, the dashboard's own), reads as "—" while nothing is
 * known, and says so in a sentence when the read failed — a balance that
 * cannot be read is NOT zero, and this card never prints one.
 *
 * The figure is THIS tool's wallet (Part 3, §2 — `ai_product_balances`,
 * product `character_replace`), never the platform's. Recharge is a callback:
 * the step owns the sheet (recharge-sheet.tsx) because the insufficient
 * panel opens the same one. Nothing on this card moves money (§11).
 */
export function CharacterReplaceBalanceCard({
  balance,
  error,
  notice,
  onDismissNotice,
  onRecharge,
  className,
}: {
  balance: CharacterReplaceBalance | null;
  error: string | null;
  /** What a finished recharge said, shown once. */
  notice: string | null;
  onDismissNotice: () => void;
  onRecharge: () => void;
  className?: string;
}) {
  const [hidden, toggleHidden] = useBalanceHidden();
  return (
    <div className={cn("rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5", className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow-sm">
          <Wallet className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Character Replace balance</p>
          {/* 2026-09-20: one tap hides the figure (kept per browser, shared with the balance page) */}
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              toggleHidden();
            }}
            aria-pressed={hidden}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            className="mt-0.5 block text-left text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
          >
            {balance ? hidden ? <span aria-hidden>{HIDDEN_AMOUNT}</span> : <AnimatedAmount cents={balance.balanceCents} symbol={balance.symbol} /> : <span className="text-muted-foreground">—</span>}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            onRecharge();
          }}
          disabled={!balance}
          className={cn(
            "inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-bold text-background",
            "transition motion-safe:hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Recharge
        </button>
      </div>

      {error ? (
        <p role="status" className="mt-3 text-[12.5px] leading-relaxed text-rose-500">
          We couldn&apos;t check your balance. Nothing has been charged — try again in a moment.
        </p>
      ) : null}

      {notice ? (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">{notice}</p>
          <button type="button" onClick={onDismissNotice} aria-label="Dismiss" className="-m-1 rounded-full p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
