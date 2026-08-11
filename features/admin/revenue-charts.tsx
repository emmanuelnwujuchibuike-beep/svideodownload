"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";

import { AdminAreaChart, type AreaPoint } from "@/features/admin/area-chart";
import type { RevenueSeries } from "@/lib/monetization/revenue-series";
import { cn } from "@/lib/utils";

/**
 * The revenue & engagement dashboard — a GRID of single-measure panels sharing
 * one date range.
 *
 * ── 🔴 Why this is not one chart with five lines ──────────────────────────
 *
 * The brief asked for subscription revenue, ad revenue, impressions, clicks and
 * visitors "on a graph area chart". Put on one chart those need two y-axes —
 * money against counts, and impressions (tens of thousands) against clicks
 * (tens). A dual axis is the most misleading thing a chart can do, because the
 * author chooses where the lines cross and the reader believes it. Five panels
 * at five honest scales say the same thing without the lie, and reading across
 * a shared x-axis is what makes them comparable.
 *
 * ── 🔴 Two of the five measures have no data, and this says so ────────────
 *
 * AD REVENUE does not exist in this system. Networks report earnings in their
 * own dashboards and we never receive them. `revenue-overview.tsx` already
 * refuses to print an ad-revenue number for that reason, and a TREND would be
 * worse — a line is more persuasive than a figure. It is named here as missing
 * rather than omitted silently, so nobody concludes it was forgotten.
 *
 * SUBSCRIPTION REVENUE is a live snapshot (current subscribers × current
 * prices), not a ledger. Charting it would mean applying today's prices to the
 * past, inventing the very number it claims to report. It stays a stat tile —
 * the honest form for a measure with one value — until daily snapshots exist.
 */
export function RevenueCharts({
  series,
  mrr,
  currency,
  mrrComplete,
  visitors,
}: {
  series: RevenueSeries;
  mrr: number;
  currency: string;
  mrrComplete: boolean;
  /** Daily visitors from the analytics RPC — real buckets, may be absent. */
  visitors?: { date: string; visitors: number }[];
}) {
  const [range, setRange] = useState<7 | 30 | 90>(30);

  // The filter narrows an already-fetched window rather than refetching: at 90
  // days this is 90 numbers, and a round-trip to slice an array is latency for
  // nothing.
  const slice = <T,>(arr: T[]) => arr.slice(Math.max(0, arr.length - range));

  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const impressions: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.impressions }));
  const clicks: AreaPoint[] = slice(series.days).map((d) => ({ label: fmtDay(d.date), value: d.clicks }));
  const visits: AreaPoint[] = slice(visitors ?? []).map((d) => ({ label: fmtDay(d.date), value: d.visitors }));

  const totalImpr = impressions.reduce((n, p) => n + p.value, 0);
  const totalClicks = clicks.reduce((n, p) => n + p.value, 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : null;

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Revenue &amp; engagement</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every series below is a counted total. Nothing is projected or estimated.
          </p>
        </div>
        {/* Filters in ONE row above the charts, and they drive every panel — a
            per-panel range would let two charts disagree about the window. */}
        <div role="group" aria-label="Date range" className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                range === r ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {series.capped ? (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This window hit the read limit, so the earliest days are partial. The shape of the recent
          days is accurate; the totals are a floor, not the whole count.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/*
          MRR as a STAT TILE, not a chart. It is one value with no history —
          "sometimes the answer is not a chart" is exactly this case, and drawing
          a flat line across 30 identical points would imply a stability nobody
          measured.
        */}
        <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-4">
          <p className="text-xs font-medium text-muted-foreground">Subscription revenue (MRR)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {currency}
            {mrr.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {mrrComplete
              ? "Live subscriber counts × the prices set on the pricing screen."
              : "Partial — one plan has a non-numeric price and is excluded from this total."}
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            Shown as a figure rather than a trend: this is a snapshot of today, and no per-day
            history has ever been recorded to plot against.
          </p>
        </div>

        {/*
          Ad revenue is NAMED as absent. Leaving it out entirely would read as an
          oversight; an estimate would be fiction in a screen decisions are made
          from.
        */}
        <div className="rounded-2xl border border-dashed border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">Ad revenue</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">Not available</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            AdSense and Monetag report earnings in their own dashboards and do not send them here.
            Multiplying impressions by an assumed RPM would produce a confident number nobody can
            trace, so it is not shown. Impressions and clicks below are exact counts.
          </p>
        </div>

        <AdminAreaChart
          title="Ad impressions"
          subtitle={`${totalImpr.toLocaleString()} in the last ${range} days`}
          points={impressions}
          slot={1}
        />
        <AdminAreaChart
          title="Ad clicks"
          subtitle={ctr !== null ? `${totalClicks.toLocaleString()} clicks · ${ctr.toFixed(2)}% CTR` : undefined}
          points={clicks}
          slot={2}
        />
        {visits.length > 0 ? (
          <AdminAreaChart
            title="Visitors"
            subtitle={`${visits.reduce((n, p) => n + p.value, 0).toLocaleString()} in the last ${range} days`}
            points={visits}
            slot={3}
            className="lg:col-span-2"
          />
        ) : null}
      </div>
    </section>
  );
}
