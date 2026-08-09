"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, HelpCircle, Minus, XCircle } from "lucide-react";
import { useId, useState } from "react";

import { changePct, type MetricSpec, type MetricStatus } from "@/lib/analytics/metric-catalogue";
import type { AnalyticsSummary } from "@/lib/analytics/queries";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * One metric, told completely (owner, 2026-08-09: every metric should carry a
 * title, description, value, trend, percentage change, last-updated time,
 * status indicator and a tooltip explaining what it means).
 *
 * ── The two rules that shape this card ───────────────────────────────────────
 *
 * 1. DIRECTION IS PER-METRIC, NEVER PER-ARROW. "Up" is good for downloads and
 *    bad for bounce rate, so the colour comes from `higherIsBetter × direction`,
 *    read from the catalogue. A dashboard that paints every rise green is
 *    actively misleading, and it is the single easiest thing to get wrong when
 *    the styling lives in the card instead of in the definition.
 *
 * 2. NOTHING IS SAID IN COLOUR ALONE. Every trend carries an arrow AND a signed
 *    number AND the period it is compared to; every status carries an icon AND a
 *    word. That is the accessibility requirement, and it is also what makes a
 *    screenshot of this pasted into a chat still readable.
 *
 * ── What it refuses to do ────────────────────────────────────────────────────
 * An unknown trend renders as nothing, not as 0%. A rise from zero renders as
 * "new", not as +100% or ∞. Both are cases where the honest answer is that the
 * comparison does not exist, and inventing a number for it is exactly the class
 * of confident-wrong reporting this audit was about.
 */

function fmtValue(v: number, format: MetricSpec["format"]): string {
  switch (format) {
    case "percent":
      return `${v}%`;
    case "seconds":
      return v >= 60 ? `${Math.floor(v / 60)}m ${v % 60}s` : `${v}s`;
    case "bytes":
      if (v >= 1_099_511_627_776) return `${(v / 1_099_511_627_776).toFixed(2)} TB`;
      if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(2)} GB`;
      if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
      return `${Math.round(v / 1024)} KB`;
    case "currency":
      return `$${v.toFixed(2)}`;
    default:
      return formatCompactNumber(v);
  }
}

const STATUS_UI: Record<MetricStatus["level"], { Icon: typeof CheckCircle2; cls: string }> = {
  good: { Icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400" },
  warning: { Icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  critical: { Icon: XCircle, cls: "text-rose-600 dark:text-rose-400" },
};

const PERIOD_LABEL: Record<string, string> = {
  "24h": "previous 24h",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
};

export function MetricCard({ spec, summary }: { spec: MetricSpec; summary: AnalyticsSummary }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  const value = spec.value(summary);
  const prev = spec.previous(summary);
  const delta = changePct(value, prev);
  const status = spec.status?.(value, summary) ?? null;

  // direction × whether up is good. Neutral when the metric has no "better".
  const dir = delta === null ? 0 : delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const good = spec.higherIsBetter === null ? null : dir === 0 ? null : dir > 0 === spec.higherIsBetter;
  const deltaCls =
    good === null
      ? "text-muted-foreground"
      : good
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
  const Arrow = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;

  return (
    <div className="relative flex flex-col rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-xs font-bold text-foreground">{spec.title}</h4>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{spec.description}</p>
        </div>
        <button
          type="button"
          aria-label={`How ${spec.title} is measured`}
          aria-expanded={open}
          aria-controls={tipId}
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </div>

      {/*
        Proportional figures, not `tabular-nums`. Tabular gives every digit the
        width of a zero, which makes a standalone display number look loose and
        gappy; tabular belongs in COLUMNS that must align (the tables below).
      */}
      <p className="mt-2 text-[26px] font-extrabold leading-none tracking-tight text-foreground">
        {fmtValue(value, spec.format)}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta !== null ? (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-bold", deltaCls)}>
            <Arrow className="h-3 w-3" />
            {delta > 0 ? "+" : ""}
            {delta}%
            <span className="font-medium text-muted-foreground"> vs {PERIOD_LABEL[summary.range] ?? "previous"}</span>
          </span>
        ) : prev === null ? null : (
          // Previous period was zero and this one is not: a real change, but not
          // one a percentage can express.
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">new</span>
        )}

        {status ? (
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold", STATUS_UI[status.level].cls)}>
            {(() => {
              const { Icon } = STATUS_UI[status.level];
              return <Icon className="h-3 w-3" />;
            })()}
            {status.label}
          </span>
        ) : null}
      </div>

      {open ? (
        <p
          id={tipId}
          role="note"
          className="mt-2.5 rounded-xl bg-secondary/70 p-2 text-[11px] leading-relaxed text-muted-foreground"
        >
          {spec.measurement}
        </p>
      ) : null}
    </div>
  );
}
