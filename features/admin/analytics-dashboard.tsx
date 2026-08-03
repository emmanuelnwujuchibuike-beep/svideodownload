"use client";

import { Activity, Download, Eye, Globe2, Loader2, MonitorSmartphone, Radio, TrendingUp, Users } from "lucide-react";
import { type ComponentType, useCallback, useEffect, useState } from "react";

import type { AnalyticsSummary, Breakdown, Range } from "@/lib/analytics/queries";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Live-ish admin analytics dashboard (Phase 2/3). Self-loads from
 * /api/admin/analytics and polls every 15s for a live feel (SSE is a later phase).
 * Reads the Phase-1 event pipeline — empty until migration 0103 is applied + traffic
 * flows, then it fills in.
 */
const RANGES: { key: Range; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function AnalyticsDashboard() {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: Range) => {
    try {
      const res = await fetch(`/api/admin/analytics?range=${r}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* keep the last snapshot */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(range);
    const id = setInterval(() => void load(range), 15_000);
    return () => clearInterval(id);
  }, [range, load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold">Traffic &amp; downloads</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
            <Radio className="h-3.5 w-3.5 animate-pulse" /> Live
          </span>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="inline-flex rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition active:scale-[0.96]",
                range === r.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Radio} label="Live visitors" value={data?.liveVisitors ?? 0} accent="emerald" />
        <Stat icon={Users} label="Unique visitors" value={data?.uniqueVisitors ?? 0} accent="blue" />
        <Stat icon={Activity} label="Sessions" value={data?.sessions ?? 0} accent="violet" />
        <Stat icon={Eye} label="Page views" value={data?.pageViews ?? 0} accent="cyan" />
        <Stat icon={Download} label="Downloads" value={data?.downloads.total ?? 0} accent="fuchsia" />
        <Stat icon={TrendingUp} label="Success rate" value={data ? `${data.downloads.successRate}%` : "—"} accent="amber" raw />
      </div>

      {data && data.downloads.total > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Completed" value={data.downloads.completed} tone="emerald" />
          <MiniStat label="Failed" value={data.downloads.failed} tone="rose" />
          <MiniStat label="Success rate" value={`${data.downloads.successRate}%`} tone="blue" raw />
        </div>
      ) : null}

      {/* Breakdowns */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BreakdownCard icon={TrendingUp} title="Top platforms" rows={data?.topPlatforms ?? []} />
        <BreakdownCard icon={MonitorSmartphone} title="Device" rows={data?.byDevice ?? []} />
        <BreakdownCard icon={Globe2} title="Browser" rows={data?.byBrowser ?? []} />
        <BreakdownCard icon={Globe2} title="Country" rows={data?.byCountry ?? []} />
      </div>

      <p className="px-1 text-[11px] text-muted-foreground">
        {data && data.totalEvents === 0
          ? "No analytics yet — this fills in once migration 0103 is applied and traffic flows."
          : `Updated ${data ? new Date(data.generatedAt).toLocaleTimeString() : "…"}${data?.approxBreakdowns ? " · breakdowns sampled" : ""}.`}
      </p>
    </section>
  );
}

const ACCENTS: Record<string, string> = {
  emerald: "from-emerald-500/15 to-teal-500/15 text-emerald-500 ring-emerald-500/20",
  blue: "from-blue-500/15 to-indigo-500/15 text-blue-500 ring-blue-500/20",
  violet: "from-violet-500/15 to-purple-500/15 text-violet-500 ring-violet-500/20",
  cyan: "from-cyan-500/15 to-sky-500/15 text-cyan-500 ring-cyan-500/20",
  fuchsia: "from-fuchsia-500/15 to-pink-500/15 text-fuchsia-500 ring-fuchsia-500/20",
  amber: "from-amber-500/15 to-orange-500/15 text-amber-500 ring-amber-500/20",
};

function Stat({ icon: Icon, label, value, accent, raw }: { icon: ComponentType<{ className?: string }>; label: string; value: number | string; accent: string; raw?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset", ACCENTS[accent])}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <p className="mt-2.5 text-2xl font-extrabold tracking-tight tabular-nums">{raw ? value : formatCompactNumber(Number(value))}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, tone, raw }: { label: string; value: number | string; tone: string; raw?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-center shadow-sm">
      <p className={cn("text-lg font-extrabold tabular-nums", tone === "emerald" ? "text-emerald-500" : tone === "rose" ? "text-rose-500" : "text-blue-500")}>
        {raw ? value : formatCompactNumber(Number(value))}
      </p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function BreakdownCard({ icon: Icon, title, rows }: { icon: ComponentType<{ className?: string }>; title: string; rows: Breakdown[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h4>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium capitalize">{r.key}</span>
                <span className="tabular-nums text-muted-foreground">{formatCompactNumber(r.count)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
