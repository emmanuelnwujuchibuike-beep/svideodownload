"use client";

import { useMemo, useState } from "react";

import { groupSeries, type DayPoint, type Grouping } from "@/lib/analytics/group-series";
import { cn } from "@/lib/utils";

import { AdminAreaChart } from "./area-chart";

/**
 * Page views, with a Daily / Weekly / Monthly toggle.
 *
 * Owner, 2026-09-02: "put a daily , weekly and monthly trend and button in the
 * page view chart , they must be very accurate."
 *
 * The arithmetic is in `lib/analytics/group-series.ts` and is tested there — a
 * rollup that double-counts a boundary day or drops the edge produces a chart
 * that is confidently wrong while still looking plausible, so it is not
 * something to verify by looking at it.
 *
 * ── Partial periods are labelled, not hidden ────────────────────────────
 * The current week is two days old on a Tuesday. Plotted beside seven-day weeks
 * it reads as a collapse in traffic, and somebody acts on that. The trailing
 * bucket says "(partial)" in its tooltip and the note under the chart says how
 * many days it actually covers.
 *
 * `today` is computed once per render and passed down, so completeness cannot
 * disagree with itself between two points on the same chart.
 */

const OPTIONS: { key: Grouping; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export function PageViewsChart({ series }: { series: DayPoint[] }) {
  const [grouping, setGrouping] = useState<Grouping>("daily");

  const today = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const grouped = useMemo(() => groupSeries(series, grouping, today), [series, grouping, today]);

  if (grouped.length < 2) return null;

  const trailing = grouped[grouped.length - 1]!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Page views</h3>
        <div
          role="group"
          aria-label="Group page views by"
          className="inline-flex rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setGrouping(o.key)}
              aria-pressed={grouping === o.key}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                grouping === o.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <AdminAreaChart
        title=""
        slot={3}
        points={grouped.map((g) => ({ label: g.label, value: g.value, fullLabel: g.fullLabel }))}
      />

      {!trailing.complete ? (
        <p className="text-[11px] text-muted-foreground">
          The last {grouping === "daily" ? "day" : grouping === "weekly" ? "week" : "month"} is still in
          progress — it covers {trailing.days} {trailing.days === 1 ? "day" : "days"} of data, so it is not
          comparable to the complete {grouping === "daily" ? "days" : grouping === "weekly" ? "weeks" : "months"}{" "}
          beside it.
        </p>
      ) : null}
    </div>
  );
}
