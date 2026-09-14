"use client";

import { ChevronDown, Scissors } from "lucide-react";
import { useId, useState } from "react";

import type { PricingLine, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds } from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PRICE — the total, and the arithmetic behind it on request
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §13):
 *
 *     Video processing          10.0 sec × ₦25     ₦250
 *     Quality                   720p
 *     Character replacement     Included
 *     Voice                     Original audio
 *     Lip sync                  Not selected
 *     ─────────────────────────────────────────────
 *     Total                     ₦250
 *
 * "Show the price in a clean summary… with an expandable 'Price details'
 * section." The total is the headline; the rows sit under a disclosure that
 * opens on request, so a phone shows one number and a member who wants the
 * working sees all of it.
 *
 * ── 🔴 THE TOTAL IS A STATE, NOT A NUMBER ────────────────────────────────────
 *
 * The rows come from the draft (what was chosen); the amounts come from the
 * server (what it costs). `PricingState` says which of five things the total
 * area is showing, and the card renders each in words:
 *
 *   quoted    the server's total, with any savings sentences under it.
 *   stale     the last total, dimmed, and "updating…" — the inputs moved.
 *   pending   the inputs are complete; the server has not answered yet.
 *   error     "We couldn't price this." and a Try again.
 *   idle      nothing to price yet.
 *
 * §10: "Do NOT fake dynamic calculations." Nothing here multiplies anything;
 * the "10.0 sec × ₦25" reading is the server's own rate line, printed.
 */
export function CharacterReplacePricingSummary({
  lines,
  pricing,
  trimmed,
  symbol,
  onRetry,
  compact = false,
  className,
}: {
  /** The rows, from the draft. Amounts are null until a snapshot has them. */
  lines: readonly PricingLine[];
  pricing: PricingState;
  /** Seconds the member's trim removed — the informative hint, never a price. */
  trimmed: number | null;
  /** The currency symbol, for the quoted states. */
  symbol: string;
  onRetry?: () => void;
  /** The settings step's version: the total and the hint, no disclosure. */
  compact?: boolean;
  className?: string;
}) {
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const snapshot = pricing.status === "quoted" || pricing.status === "stale" ? pricing.snapshot : null;
  // A quoted line replaces the draft line of the same key: same label, real amount.
  const rows = snapshot ? snapshot.lines : lines;
  const total = snapshot ? formatCents(snapshot.totalCents, snapshot.symbol) : null;
  const seconds = snapshot ? `${(Math.round(snapshot.durationMs / 100) / 10).toFixed(1)} sec` : null;

  return (
    <section
      aria-labelledby={`${detailsId}-title`}
      className={cn("rounded-[1.25rem] border border-border/70 bg-card", pricing.status === "idle" && "border-dashed bg-card/60", className)}
    >
      <div className="flex items-baseline justify-between gap-4 px-4 pt-3.5">
        <h3 id={`${detailsId}-title`} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {compact ? "Estimated cost" : "Total"}
        </h3>
        <p
          aria-live="polite"
          className={cn(
            "text-right text-[22px] font-bold leading-none tabular-nums tracking-[-0.02em] transition-opacity",
            pricing.status === "stale" && "opacity-50",
          )}
        >
          {total ?? <span className="text-[18px] text-muted-foreground">{pricing.status === "pending" ? "…" : "—"}</span>}
        </p>
      </div>

      {/* the state, in words */}
      <p className="mt-1.5 px-4 text-[12.5px] leading-relaxed text-muted-foreground" aria-live="polite">
        {pricing.status === "stale"
          ? "Your settings changed — updating the price."
          : pricing.status === "pending"
            ? "Calculating the exact price…"
            : pricing.status === "error"
              ? pricing.message
              : pricing.status === "idle"
                ? "Add a photo and a video to see a price."
                : seconds
                  ? `For ${seconds} of video. You'll only be charged when processing starts.`
                  : "You'll only be charged this amount when processing starts."}
        {pricing.status === "error" && onRetry ? (
          <>
            {" "}
            <button type="button" onClick={onRetry} className="font-semibold text-primary underline-offset-2 hover:underline">
              Try again
            </button>
          </>
        ) : null}
      </p>

      {/* the informative sentences (§10): the server's savings, and the one fact the draft knows on its own */}
      {snapshot?.savings.length ? (
        <ul className="mt-2 space-y-1 px-4">
          {snapshot.savings.map((s) => (
            <li key={s.message} className="text-[12.5px] leading-relaxed text-primary">
              {s.message}
            </li>
          ))}
        </ul>
      ) : null}
      {trimmed !== null && trimmed > 0.05 ? (
        <p className="mt-2 flex items-center gap-1.5 px-4 text-[12.5px] text-muted-foreground">
          <Scissors className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
          Trimmed by {formatSeconds(trimmed)} — a shorter video costs less.
        </p>
      ) : trimmed === 0 && pricing.status !== "idle" ? (
        <p className="mt-2 flex items-center gap-1.5 px-4 text-[12.5px] text-muted-foreground">
          <Scissors className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
          Trim the video to reduce processing cost.
        </p>
      ) : null}

      {compact ? (
        <div className="pb-3.5" />
      ) : (
        <>
          {/* ── Price details, on request ───────────────────────────────── */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((o) => !o)}
            className="mt-3 flex w-full items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-left text-[13px] font-semibold transition hover:bg-secondary/40"
          >
            Price details
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          <div id={detailsId} hidden={!open} className="px-4 pb-3.5">
            <dl className="divide-y divide-border/60">
              {rows.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
                  <dd className="text-right text-[13px] font-semibold tabular-nums">
                    {row.value}
                    {row.amountCents !== null ? (
                      <span className="ml-2 text-muted-foreground">{formatCents(row.amountCents, snapshot?.symbol ?? symbol)}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
              {snapshot && snapshot.minimumApplied ? (
                <div className="py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  The minimum charge of {formatCents(snapshot.minimumChargeCents, snapshot.symbol)} applies because this video is short.
                </div>
              ) : null}
            </dl>
            {snapshot ? (
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                Quoted by Frenz AI · pricing v{snapshot.pricingConfigVersion}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
