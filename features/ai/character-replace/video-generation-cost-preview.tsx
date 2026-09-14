"use client";

import { CharacterReplacePricingSummary } from "@/features/ai/character-replace/pricing-summary";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceProject, PricingState } from "@/lib/ai/character-replace/types";
import { formatSeconds, qualityLabelFor, selectedDurationSeconds, summaryLines, trimmedSeconds } from "@/lib/ai/character-replace/workspace";
import { formatCents } from "@/lib/ai/economy";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VideoGenerationCostPreview — one component, every mode, always current
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Skin + Face brief §13: "Create one reusable component:
 * VideoGenerationCostPreview. It should automatically update whenever:
 * video changes, duration changes, quality changes, pricing changes,
 * replacement mode changes. Formula: cost = duration × pricePerSecond.
 * Display: 12.4s × $0.06/s = $0.74. Do not require the user to manually
 * calculate anything."
 *
 * Face Only brief §3: "Video: 12.4 seconds · Quality: High · Rate:
 * $0.025/sec · Estimated cost: $0.31."
 *
 * ── 🔴 NOTHING HERE MULTIPLIES ─────────────────────────────────────────────
 *
 * The quote request goes out the moment any of those inputs moves
 * (use-character-replace-workspace.ts marks the price stale on each), and
 * this component prints what the SERVER answered — `rateLine` and the
 * amounts are the server's own strings and integers. Before the answer, and
 * while it is stale, the previous figure dims and the sentence says why. The
 * arithmetic the member sees is the arithmetic the ledger will record.
 */
export function VideoGenerationCostPreview({
  project,
  config,
  pricing,
  symbol,
  onRetry,
  compact = false,
  className,
}: {
  project: CharacterReplaceProject;
  config: CharacterReplacePublicConfig | null;
  pricing: PricingState;
  symbol: string;
  onRetry?: () => void;
  /** The settings step's version: the four facts and the total, no disclosure. */
  compact?: boolean;
  className?: string;
}) {
  const snapshot = pricing.status === "quoted" || pricing.status === "stale" ? pricing.snapshot : null;
  const seconds = selectedDurationSeconds(project);
  const modeLabel = REPLACEMENT_MODE_COPY[project.mode].label;
  const qualityLabel = qualityLabelFor(project, config);
  const dim = pricing.status === "stale" || pricing.status === "pending";

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── the four facts (Face Only brief §3) ───────────────────────────── */}
      <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-2 rounded-[1.25rem] border border-border/70 bg-card px-4 py-3.5 text-[13px] sm:grid-cols-4", dim && "opacity-70")} aria-live="polite">
        <Fact label="Replacement" value={modeLabel} />
        <Fact label="Video" value={snapshot ? `${(Math.round(snapshot.durationMs / 100) / 10).toFixed(1)} seconds` : seconds !== null ? formatSeconds(seconds).replace(" sec", " seconds") : "—"} />
        <Fact label="Quality" value={qualityLabel} />
        <Fact
          label="Rate"
          value={snapshot ? `${formatCents(snapshot.qualityRateCents, snapshot.symbol)}/sec` : pricing.status === "pending" || pricing.status === "stale" ? "…" : "—"}
        />
        {snapshot ? (
          <div className="col-span-2 mt-1 border-t border-border/60 pt-2 sm:col-span-4">
            <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Estimated cost</span>
            <span className="mt-0.5 block text-[14px] font-bold tabular-nums tracking-[-0.01em]">{snapshot.rateLine}</span>
            {snapshot.voiceCents > 0 || snapshot.lipSyncCents > 0 || snapshot.basePriceCents > 0 || snapshot.minimumApplied ? (
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                {[
                  snapshot.basePriceCents > 0 ? `+ ${formatCents(snapshot.basePriceCents, snapshot.symbol)} processing` : null,
                  snapshot.voiceCents > 0 ? `+ ${formatCents(snapshot.voiceCents, snapshot.symbol)} voice` : null,
                  snapshot.lipSyncCents > 0 ? `+ ${formatCents(snapshot.lipSyncCents, snapshot.symbol)} lip sync` : null,
                  snapshot.minimumApplied ? `minimum charge applied` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {" = "}
                <strong className="text-foreground">{formatCents(snapshot.totalCents, snapshot.symbol)}</strong>
              </span>
            ) : null}
          </div>
        ) : null}
      </dl>

      {/* ── the total, the state in words, and the details on request ───── */}
      <CharacterReplacePricingSummary
        lines={summaryLines(project, config)}
        pricing={pricing}
        trimmed={trimmedSeconds(project)}
        symbol={symbol}
        onRetry={onRetry}
        compact={compact}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}
