"use client";

import { ChevronDown, Scissors } from "lucide-react";
import { useId, useState } from "react";

import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceProject, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds, qualityLabelFor, selectedDurationSeconds, summaryLines, trimmedSeconds } from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VideoGenerationCostPreview — the one price card (Part 6 §13, Part 9 §12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One card, read top to bottom: what the video is (duration, quality), what
 * each part costs (the replacement's rate line, a voice, lip sync, the
 * minimum), the total, and — when the member's balance is known — where
 * that leaves them. Part 9 folded the two cards that used to stand here
 * (a facts grid and a separate total) into this one; the same number was
 * printed twice and the eye had to reconcile them.
 *
 * 🔴 EVERY AMOUNT IS THE SERVER'S. `rateLine`, the line amounts, the total
 * and the savings are copied from the quote (lib/ai/character-replace/
 * pricing.ts through /api/ai/character-replace/quote); nothing here
 * multiplies. Before the answer, and while it is stale, the previous figure
 * dims and the sentence says why. The arithmetic the member sees is the
 * arithmetic the ledger records.
 */
export function VideoGenerationCostPreview({
  project,
  config,
  pricing,
  symbol,
  onRetry,
  balanceCents = null,
  compact = false,
  className,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig | null;
  pricing: PricingState;
  symbol: string;
  onRetry?: () => void;
  /** The member's Character Replace balance, minor units — the review step passes it; the settings step does not. */
  balanceCents?: number | null;
  /** The settings step's version: no disclosure, no balance rows. */
  compact?: boolean;
  className?: string;
}) {
  const detailsId = useId();
  const [open, setOpen] = useState(false);
  const snapshot = pricing.status === "quoted" || pricing.status === "stale" ? pricing.snapshot : null;
  const seconds = selectedDurationSeconds(project);
  const modeLabel = REPLACEMENT_MODE_COPY[project.mode].label;
  const qualityLabel = qualityLabelFor(project, config);
  const dim = pricing.status === "stale" || pricing.status === "pending";
  const sym = snapshot?.symbol ?? symbol;
  const total = snapshot ? formatCents(snapshot.totalCents, sym) : null;
  const trimmed = trimmedSeconds(project);
  // Part 11 §7: a complimentary creation shows the normal price and charges nothing; the balance is untouched
  const complimentary = snapshot?.billing?.complimentary === true;
  const after = snapshot && balanceCents !== null ? (complimentary ? balanceCents : balanceCents - snapshot.totalCents) : null;
  const draft = summaryLines(project, config);
  const voiceLine = draft.find((l) => l.key === "voice");
  const lipLine = draft.find((l) => l.key === "lipSync");

  return (
    <section
      aria-labelledby={`${detailsId}-title`}
      aria-live="polite"
      className={cn("rounded-[1.25rem] border border-border/70 bg-card", pricing.status === "idle" && "border-dashed bg-card/60", className)}
    >
      {/* ── the heading and the total ─────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-4 px-4 pt-3.5">
        <h3 id={`${detailsId}-title`} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {complimentary ? "Complimentary creation" : "Estimated cost"}
        </h3>
        <p className={cn("text-right text-[22px] font-bold leading-none tabular-nums tracking-[-0.02em] transition-opacity", pricing.status === "stale" && "opacity-50")}>
          {complimentary ? (
            <span className="text-gradient">FREE</span>
          ) : (
            (total ?? <span className="text-[18px] text-muted-foreground">{pricing.status === "pending" ? "…" : "—"}</span>)
          )}
        </p>
      </div>

      {/* ── the lines ─────────────────────────────────────────────────────── */}
      <dl className={cn("mt-3 divide-y divide-border/60 border-t border-border/60 px-4 text-[13px]", dim && "opacity-70")}>
        <Row label="Video duration" value={snapshot ? `${(Math.round(snapshot.durationMs / 100) / 10).toFixed(1)} sec` : seconds !== null ? formatSeconds(seconds) : "—"} />
        <Row label="Quality" value={qualityLabel} />
        <Row
          label={modeLabel}
          value={snapshot ? snapshot.rateLine : pricing.status === "pending" || pricing.status === "stale" ? "…" : "—"}
        />
        {snapshot && snapshot.basePriceCents > 0 ? <Row label="Processing" value="" amount={formatCents(snapshot.basePriceCents, sym)} /> : null}
        {project.voice.mode === "new_voice" ? <Row label="Voice" value={voiceLine?.value ?? ""} amount={snapshot ? (snapshot.voiceCents > 0 ? formatCents(snapshot.voiceCents, sym) : "Included") : null} /> : null}
        {project.voice.mode === "new_voice" && project.lipSync.tier ? (
          <Row label={project.lipSync.tier === "studio" ? "Premium Lip Sync" : "Lip Sync"} value={lipLine?.value ?? ""} amount={snapshot ? (snapshot.lipSyncCents > 0 ? formatCents(snapshot.lipSyncCents, sym) : "Included") : null} />
        ) : null}
        {snapshot?.minimumApplied ? <Row label="Minimum charge" value="applies to a short video" amount={formatCents(snapshot.minimumChargeCents, sym)} /> : null}
        {complimentary ? (
          <>
            <Row label="Normal price" value="" amount={total ?? "—"} />
            <Row label="Today's creation" value="" amount="FREE" strong tone="ok" />
          </>
        ) : (
          <Row label="Total" value="" amount={total ?? "—"} strong />
        )}
        {!compact && balanceCents !== null ? (
          <>
            <Row label="Current balance" value="" amount={formatCents(balanceCents, sym)} />
            {after !== null ? (
              <Row label={after < 0 ? "Short by" : "Balance after"} value="" amount={formatCents(Math.abs(after), sym)} tone={after < 0 ? "warn" : "ok"} />
            ) : null}
          </>
        ) : null}
      </dl>

      {/* ── the state, in words ───────────────────────────────────────────── */}
      <p className="mt-2.5 px-4 text-[12.5px] leading-relaxed text-muted-foreground">
        {pricing.status === "stale"
          ? "Your settings changed — updating the price."
          : pricing.status === "pending"
            ? "Calculating the exact price…"
            : pricing.status === "error"
              ? pricing.message
              : pricing.status === "idle"
                ? "Add a photo and a video to see a price."
                : complimentary
                  ? "Your complimentary creation will be used for this video. Nothing is charged."
                  : snapshot?.billing?.notFreeBecause
                    ? `${snapshot.billing.notFreeBecause} You'll only be charged this amount when processing starts.`
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
      ) : null}

      {compact || !snapshot ? (
        <div className="pb-3.5" />
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((o) => !o)}
            className="mt-3 flex w-full items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-left text-[13px] font-semibold transition hover:bg-secondary/40"
          >
            How this price was worked out
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          <div id={detailsId} hidden={!open} className="px-4 pb-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <p>
              {snapshot.rateLine} for the replacement
              {snapshot.voiceCents > 0 ? `, ${formatCents(snapshot.voiceCents, sym)} for the voice` : ""}
              {snapshot.lipSyncCents > 0 ? `, ${formatCents(snapshot.lipSyncCents, sym)} for lip sync` : ""}
              {snapshot.basePriceCents > 0 ? `, ${formatCents(snapshot.basePriceCents, sym)} processing` : ""}
              {snapshot.minimumApplied ? ` — below the ${formatCents(snapshot.minimumChargeCents, sym)} minimum, so the minimum applies` : ""}.
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground/80">Quoted by Frenz AI · pricing v{snapshot.pricingConfigVersion}. The amount is reserved when processing starts and refunded in full if the video cannot be made.</p>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ label, value, amount = null, strong = false, tone }: { label: string; value: string; amount?: string | null; strong?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2", strong && "py-2.5")}>
      <dt className={cn("shrink-0", strong ? "text-[13.5px] font-bold" : "text-muted-foreground")}>{label}</dt>
      <dd className="flex min-w-0 items-baseline justify-end gap-2 text-right">
        {value ? <span className={cn("truncate", strong ? "font-semibold" : "font-medium")}>{value}</span> : null}
        {amount !== null ? (
          <span className={cn("shrink-0 tabular-nums", strong ? "text-[15px] font-bold" : "font-semibold", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "ok" && "text-emerald-600 dark:text-emerald-400")}>{amount}</span>
        ) : null}
      </dd>
    </div>
  );
}
