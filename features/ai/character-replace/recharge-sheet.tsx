"use client";

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { beginCharacterReplaceTopup } from "@/lib/ai/character-replace/client";
import { convertUsdCents } from "@/lib/ai/character-replace/topup-fx";
import type { CharacterReplaceBalance } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
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
 *  RECHARGE — the operator's packages, a custom amount, and Paystack
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §17): "Recharge packages: ₦500, ₦1,000,
 * ₦2,500, ₦5,000, ₦10,000, custom amount… The recharge UI should be clean and
 * premium." The packages and the bounds come with the balance from the
 * server (`/api/ai/character-replace/balance`), never from a constant here.
 *
 * Opened from two places — the balance card's Recharge, and the insufficient
 * panel's — which is why it is its own component with an `open` the step
 * owns. Whichever amount is chosen, the server re-checks it against the same
 * bounds and answers with Paystack's page (§11: nothing here moves money).
 *
 * A preset is SELECTED first and confirmed with one button, so a tap on the
 * wrong figure is a tap away from fixing, not a navigation to a payment page.
 * A custom amount types into the same confirm.
 */
export function CharacterReplaceRechargeSheet({
  open,
  onClose,
  balance,
  returnTo,
  /** What the member is short by, if they came here from the insufficient panel. */
  suggestedCents = null,
}: {
  open: boolean;
  onClose: () => void;
  balance: CharacterReplaceBalance;
  returnTo: string;
  suggestedCents?: number | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");

  /*
    Coming from "Short by ₦450": the smallest package that covers it is
    pre-selected, so the obvious next tap is the right one. Nothing is chosen
    otherwise — the member picks.
  */
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (suggestedCents !== null && suggestedCents > 0) {
      const covering = [...balance.topupOptionsCents].sort((a, b) => a - b).find((c) => c >= suggestedCents) ?? null;
      setSelected(covering);
      setCustom(covering === null ? String(Math.ceil(Math.max(suggestedCents, balance.minTopupCents) / 100)) : "");
    } else {
      setSelected(null);
      setCustom("");
    }
  }, [open, suggestedCents, balance.topupOptionsCents, balance.minTopupCents]);

  const customCents = custom.trim() === "" ? null : Math.round(Number(custom) * 100);
  const chosen = selected ?? (customCents !== null && Number.isFinite(customCents) ? customCents : null);
  const withinBounds = chosen !== null && Number.isInteger(chosen) && chosen >= balance.minTopupCents && chosen <= balance.maxTopupCents;

  const confirm = useCallback(async () => {
    if (chosen === null || !withinBounds) return;
    haptic("selection");
    setBusy(true);
    setError(null);
    const res = await beginCharacterReplaceTopup(chosen, returnTo);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    // A full navigation to the hosted payment page — never a popup.
    window.location.assign(res.url);
  }, [chosen, returnTo, withinBounds]);

  return (
    <GlassSheetShell open={open} onClose={onClose} title="Add Character Replace balance" fitContent defaultHeightVh={78}>
      <div className="px-4 pb-6">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Choose an amount. You&apos;ll pay on a secure page and come straight back here — the balance is only ever used for
          Character Replace.
        </p>

        {suggestedCents !== null && suggestedCents > 0 ? (
          <p className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5 text-[12.5px] leading-relaxed">
            You need <strong className="font-bold tabular-nums">{formatCents(suggestedCents, balance.symbol)}</strong> more for this video.
          </p>
        ) : null}

        <div role="radiogroup" aria-label="Recharge amount" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {balance.topupOptionsCents.map((cents) => {
            const active = selected === cents;
            return (
              <button
                key={cents}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => {
                  haptic("selection");
                  setSelected(cents);
                  setCustom("");
                }}
                className={cn(
                  "relative min-h-[56px] rounded-2xl border px-2 text-[15px] font-bold tabular-nums transition active:scale-[0.97] disabled:opacity-60",
                  active
                    ? "border-foreground bg-foreground text-background shadow-[0_10px_24px_-14px_rgb(0_0_0/0.6)]"
                    : "border-border/70 bg-background hover:border-foreground/25",
                )}
              >
                {formatCents(cents, balance.symbol)}
                {active ? (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-background/20">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Custom amount</span>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-[14px] font-bold text-muted-foreground">
            {balance.symbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Custom amount"
            value={custom}
            disabled={busy}
            onChange={(e) => {
              setCustom(e.target.value.replace(/[^\d.]/g, ""));
              setSelected(null);
            }}
            className={cn(
              "h-[56px] w-full rounded-2xl border bg-background pl-9 pr-3 text-[15px] font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === null && custom !== "" ? "border-foreground" : "border-border/70",
            )}
          />
        </label>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          From {formatCents(balance.minTopupCents, balance.symbol)} to {formatCents(balance.maxTopupCents, balance.symbol)}.
        </p>
        {balance.checkout && chosen !== null && withinBounds ? (
          /* 2026-09-20: a USD wallet paid for in naira — the number the secure page will show, at the operator's rate */
          <p className="mt-2 rounded-xl bg-secondary/60 px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground" aria-live="polite">
            You&apos;ll pay <strong className="font-bold tabular-nums text-foreground">{formatCents(convertUsdCents(chosen, balance.checkout.minorPerUsd), balance.checkout.symbol)}</strong> on the secure page — {formatCents(chosen, balance.symbol)} at{" "}
            {formatCents(balance.checkout.minorPerUsd, balance.checkout.symbol)} per $1. Your balance is credited in {balance.currency}.
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || !withinBounds}
          onClick={() => void confirm()}
          className={cn(
            "mt-4 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold text-white",
            "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 shadow-[0_14px_34px_-14px_rgb(99_102_241/0.9)]",
            "transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
          )}
        >
          {busy ? "Opening secure payment…" : chosen !== null && withinBounds ? `Pay ${formatCents(chosen, balance.symbol)}` : "Choose an amount"}
        </button>

        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-500">
            {error}
          </p>
        ) : null}
      </div>
    </GlassSheetShell>
  );
}
