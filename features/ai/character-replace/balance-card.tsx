"use client";

import { Plus, Wallet, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { AnimatedAmount } from "@/features/ai/animated-amount";
import { beginCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance } from "@/lib/ai/character-replace/types";
import { formatCents, isAcceptableTopupCents } from "@/lib/ai/economy";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/*
  The sheet is the product's own (framer-motion inside), and it is fetched
  only when Recharge is pressed — the same split the AI dashboard uses, for
  the same reason: the workspace must not carry a sheet nobody has opened.
*/
const GlassSheetShell = dynamic(() => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell), {
  ssr: false,
});

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
 * Recharge opens a sheet with the operator's amounts and a custom field, and
 * hands the chosen amount to the platform top-up route, which answers with
 * Paystack's page. Nothing on this card moves money (§11).
 */
export function CharacterReplaceBalanceCard({
  balance,
  error,
  notice,
  onDismissNotice,
  returnTo,
  className,
}: {
  balance: CharacterReplaceBalance | null;
  error: string | null;
  /** What a finished recharge said, shown once. */
  notice: string | null;
  onDismissNotice: () => void;
  /** Where Paystack should send the member back. Allow-listed server-side. */
  returnTo: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  const openSheet = useCallback(() => {
    haptic("selection");
    setMounted(true);
    setOpen(true);
  }, []);
  const closeSheet = useCallback(() => setOpen(false), []);

  const topup = useCallback(
    async (amountCents: number) => {
      setBusy(true);
      setSheetError(null);
      const res = await beginCharacterReplaceTopup(amountCents, returnTo);
      if (!res.ok) {
        setSheetError(res.error);
        setBusy(false);
        return;
      }
      // A full navigation to the hosted payment page — never a popup.
      window.location.assign(res.url);
    },
    [returnTo],
  );

  const customCents = custom.trim() === "" ? null : Math.round(Number(custom) * 100);
  const customValid = balance !== null && customCents !== null && isAcceptableTopupCents(customCents, balance.minTopupCents);

  return (
    <div className={cn("rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5", className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow-sm">
          <Wallet className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Character Replace balance</p>
          <p className="mt-0.5 text-[22px] font-bold leading-none tracking-[-0.02em] tabular-nums">
            {balance ? (
              <AnimatedAmount cents={balance.balanceCents} symbol={balance.symbol} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={openSheet}
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

      {mounted && balance ? (
        <GlassSheetShell open={open} onClose={closeSheet} title="Add balance" fitContent defaultHeightVh={70}>
          <div className="px-4 pb-6">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Choose an amount. You&apos;ll pay on a secure page and come straight back here.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {balance.topupOptionsCents.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  disabled={busy}
                  onClick={() => void topup(cents)}
                  className={cn(
                    "min-h-[52px] rounded-2xl border border-border/70 bg-background px-2 text-[15px] font-bold tabular-nums",
                    "transition hover:border-foreground/25 active:scale-[0.97] disabled:opacity-60",
                  )}
                >
                  {formatCents(cents, balance.symbol)}
                </button>
              ))}
            </div>

            <form
              className="mt-3 flex items-stretch gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (customValid && customCents !== null) void topup(customCents);
              }}
            >
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Custom amount</span>
                <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[14px] font-bold text-muted-foreground">
                  {balance.symbol}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Any amount"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-[52px] w-full rounded-2xl border border-border/70 bg-background pl-9 pr-3 text-[15px] font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !customValid}
                className="btn-lux bg-foreground text-background disabled:opacity-50"
              >
                Continue
              </button>
            </form>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              From {formatCents(balance.minTopupCents, balance.symbol)} to {formatCents(balance.maxTopupCents, balance.symbol)}.
            </p>
            {sheetError ? (
              <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-500">
                {sheetError}
              </p>
            ) : null}
          </div>
        </GlassSheetShell>
      ) : null}
    </div>
  );
}
