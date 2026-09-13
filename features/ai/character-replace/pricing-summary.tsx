"use client";

import { Scissors } from "lucide-react";

import type { PricingLine, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds } from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ESTIMATED COST — the summary card
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 1, §8):
 *
 *     Estimated cost
 *     Video               10.0 sec
 *     Quality             720p
 *     Character replacement   Included
 *     Lip sync            Not selected
 *     ───────────────────────────────
 *     Estimated total     ₦XXX
 *
 * ── 🔴 THE TOTAL IS A STATE, NOT A NUMBER ────────────────────────────────────
 *
 * The rows come from the draft (what was chosen); the amounts come from the
 * server (what it costs). `PricingState` says which of five things the total
 * area is showing, and the card renders each in words:
 *
 *   pending   "Calculated by Frenz AI before you confirm." — Part 1's only
 *             state, marked as such rather than dressed up as a number.
 *   quoted    the server's total, with any savings sentences under it.
 *   stale     the last total, dimmed, and "updating…" — the inputs moved.
 *   error     "We couldn't price this. Try again."
 *   idle      nothing to price yet.
 *
 * §10: "Do NOT fake dynamic calculations." Nothing here multiplies anything.
 */
export function CharacterReplacePricingSummary({
  lines,
  pricing,
  trimmed,
  symbol,
  className,
}: {
  /** The rows, from the draft. Amounts are null until a snapshot has them. */
  lines: readonly PricingLine[];
  pricing: PricingState;
  /** Seconds the member's trim removed — the informative hint, never a price. */
  trimmed: number | null;
  /** The currency symbol, for the quoted states. */
  symbol: string;
  className?: string;
}) {
  const snapshot = pricing.status === "quoted" || pricing.status === "stale" ? pricing.snapshot : null;
  // A quoted line replaces the draft line of the same key: same label, real amount.
  const rows = lines.map((line) => snapshot?.lines.find((l) => l.key === line.key) ?? line);

  return (
    <section aria-labelledby="cr-estimated-cost" className={cn("rounded-[1.25rem] border border-border/70 bg-card", className)}>
      <div className="px-4 pt-3.5">
        <h3 id="cr-estimated-cost" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Estimated cost
        </h3>
      </div>
      <dl className="mt-2 divide-y divide-border/60 px-4">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-[13.5px] text-muted-foreground">{row.label}</dt>
            <dd className="text-right text-[13.5px] font-semibold tabular-nums">
              {row.value}
              {row.amountCents !== null ? (
                <span className="ml-2 text-muted-foreground">{formatCents(row.amountCents, symbol)}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-1 border-t border-border/60 px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[14px] font-bold">Estimated total</p>
          <p
            aria-live="polite"
            className={cn(
              "text-right text-[18px] font-bold tabular-nums tracking-[-0.01em]",
              pricing.status === "stale" && "text-muted-foreground",
            )}
          >
            {snapshot ? formatCents(snapshot.totalCents, snapshot.symbol) : <span className="text-muted-foreground">—</span>}
          </p>
        </div>

        {/* the state, in words */}
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground" aria-live="polite">
          {pricing.status === "pending"
            ? "The exact price is calculated by Frenz AI before you confirm. Pricing isn't switched on yet, so nothing can be charged."
            : pricing.status === "stale"
              ? "Your settings changed — updating the price."
              : pricing.status === "error"
                ? pricing.message
                : pricing.status === "idle"
                  ? "Add a video to see a price."
                  : "You'll only be charged this amount when processing starts."}
        </p>

        {/* the informative sentences (§10): the server's savings, and the one fact the draft knows on its own */}
        {snapshot?.savings.length ? (
          <ul className="mt-2 space-y-1">
            {snapshot.savings.map((s) => (
              <li key={s.message} className="text-[12.5px] leading-relaxed text-primary">
                {s.message}
              </li>
            ))}
          </ul>
        ) : null}
        {trimmed !== null && trimmed > 0.05 ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Scissors className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            Trimmed by {formatSeconds(trimmed)}.
          </p>
        ) : trimmed === 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Scissors className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            Trim the video to reduce processing cost.
          </p>
        ) : null}
      </div>
    </section>
  );
}
