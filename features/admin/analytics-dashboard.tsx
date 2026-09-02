"use client";

import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  Download,
  DollarSign,
  Eye,
  FileDown,
  Globe2,
  Loader2,
  MonitorSmartphone,
  Radio,
  Search,
  Server,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { AD_METRICS, DOWNLOAD_METRICS, TRAFFIC_METRICS } from "@/lib/analytics/metric-catalogue";
import type { AdZoneStat, AnalyticsSummary, Breakdown, MonitorRow, PageStat, Range, TimeBucket } from "@/lib/analytics/queries";
import { cn, formatCompactNumber } from "@/lib/utils";

import { DownloadLogTable } from "./download-log";
import { GeoMap } from "./geo-map";
import { adminJson, useAdminLive } from "./live/use-admin-live";
import { MetricCard } from "./metric-card";

/**
 * Live admin analytics dashboard. Refreshes on the shared admin scheduler
 * (`features/admin/live/`) at the `stats` tier — once a minute while the tab is
 * visible, and NOT AT ALL while it is hidden. Surfaces traffic, a trend chart,
 * ad performance + revenue, a world map, engagement drill-downs, and
 * error/security monitoring. Reads the Phase-1 event pipeline + the monetization
 * and security tables; empty until traffic flows.
 *
 * 🔴 It used to hold an SSE connection open instead. That is the change worth
 * knowing about before editing this file — see the block comment on the effect
 * below for why a long-lived stream was the most expensive possible way to
 * deliver a number that moves a few times a minute.
 */
/**
 * The ranges this selector OFFERS — deliberately narrower than `Range`.
 *
 * `Range` gained "90d" on 2026-08-26 so the admin overview's server fetch can
 * plot visitors over the same window as revenue. That is a server-side window,
 * not a choice: this selector drives the traffic dashboard, the CSV export and
 * the download log, and each of those reads `analytics_events` under a row
 * cap. Offering 90 days there would widen the window behind a fixed cap, which
 * is the truncation trap recorded in [[returning-visitors-truncation-bug]].
 *
 * Typing the tabs to what they actually render — rather than to all of `Range`
 * — is what makes that a compile-time fact instead of a comment. It is also
 * what caught `DownloadHistoryPanel`, whose own `Range` never had "90d".
 */
export type TabRange = "24h" | "7d" | "30d";

const RANGES: { key: TabRange; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/**
 * The 24h / 7d / 30d selector.
 *
 * Exported and shared with `download-history-panel.tsx` rather than copied into
 * it. The copy existed for about ten minutes and the route budget caught it —
 * two identical selectors is both duplicated bytes on a page already at its
 * ceiling AND two places for the ranges to drift apart, which would let two
 * tabs of the same section disagree about what "7 days" means.
 */
export function RangeTabs({
  range,
  onChange,
}: {
  range: TabRange;
  onChange: (r: TabRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="inline-flex rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40"
    >
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => {
            tap();
            onChange(r.key);
          }}
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
  );
}

function tap() {
  haptic("light");
  playSound("tap");
}

export function AnalyticsDashboard() {
  // TabRange, not Range: this state feeds RangeTabs and the CSV export, and
  // neither offers the server-only 90d window. See TabRange.
  const [range, setRange] = useState<TabRange>("24h");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const lastMsg = useRef(0);

  /*
    ═════════════════════════════════════════════════════════════════════════
     🔴 THE SSE STREAM IS GONE, AND IT WAS THE SINGLE BIGGEST VERCEL COST
    ═════════════════════════════════════════════════════════════════════════

    Owner, 2026-08-30: $15 of a $20 monthly Vercel credit consumed against
    ~90–100 daily users, with this dashboard left open for hours.

    `/api/admin/analytics/stream` held a Node serverless function OPEN for five
    minutes per connection, re-running the full analytics aggregate every 10
    seconds inside it — and `EventSource` reconnects automatically when the
    server closes, so the five-minute cap did not bound anything: it just
    started another one. A dashboard left open for an hour bought 60
    function-MINUTES of continuously-billed compute and ~360 runs of a query set
    that fans out across `ad_impressions`, `ad_clicks`, `analytics_downloads`
    and several RPCs.

    Nothing about that was buying real-time. `getAnalyticsSummary` is an
    AGGREGATE over rolling windows — the numbers are counts over 24h/7d/30d, and
    they cannot meaningfully change 360 times an hour on this traffic. The
    stream was paying continuous-compute prices for a number that moves a few
    times a minute at most.

    Nor could it be salvaged by shortening its lifetime: an EventSource is
    indifferent to `visibilitychange`, so a hidden tab kept the connection — and
    the billing — alive.

    It is now an ordinary refresh on the shared scheduler at the `stats` tier
    (60s), which stops dead while the tab is hidden. That is the brief's
    "important dashboard statistics: 30–60 seconds", and it costs one short
    invocation a minute instead of a function that never stops running.

    Supabase Realtime is NOT the answer here either: there is no row to
    subscribe to. The value is an aggregate computed across several tables, so
    it has to be computed somewhere, and computing it in the browser would mean
    handing the browser those tables.
  */
  const { data: fresh, error } = useAdminLive<AnalyticsSummary>({
    // The range is part of the key: switching tabs is a different dataset, and
    // sharing one key across ranges would serve 7d numbers under the 24h tab.
    key: `admin:analytics:${range}`,
    tier: "stats",
    fetcher: () => adminJson<AnalyticsSummary>(`/api/admin/analytics?range=${range}`),
  });

  useEffect(() => {
    if (!fresh) return;
    setData(fresh);
    setLoading(false);
    setLive(true);
    lastMsg.current = Date.now();
  }, [fresh]);

  useEffect(() => {
    if (error) setLive(false);
  }, [error]);

  // A range change shows the spinner until that range's first payload lands.
  useEffect(() => {
    setLoading(true);
    setLive(false);
  }, [range]);

  const empty = data && data.totalEvents === 0 && data.ads.impressions === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold">Analytics</h3>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              live
                ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
                : "bg-secondary text-muted-foreground",
            )}
          >
            <Radio className={cn("h-3.5 w-3.5", live && "animate-pulse")} /> {live ? "Live" : "Reconnecting"}
          </span>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <ExportButton range={range} type="events" label="Events CSV" />
          {/* The Downloads CSV also lives on the Download history tab, next to
              the table it exports. Both are the same component and the same
              URL — this one stays because the events export beside it is
              scoped by the same range. */}
          <ExportButton range={range} type="downloads" label="Downloads CSV" />
          <RangeTabs range={range} onChange={setRange} />
        </div>
      </div>

      {/*
        A missing migration is REPORTED, never rendered as zeros.

        Until 0115 is applied every exact aggregate is unavailable, and a grid of
        confident zeros on a site with real traffic is precisely the failure this
        dashboard was audited for.
      */}
      {data && !data.rpcHealth.exactAggregates ? (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Numbers unavailable, not zero.</strong> {data.rpcHealth.note} Everything below stays blank until
            that migration runs.
          </span>
        </p>
      ) : null}

      {/*
        Every metric now carries its own title, description, trend, status and a
        tooltip explaining how it is measured (owner). The definitions live in
        lib/analytics/metric-catalogue so a description cannot drift away from
        the query that produces the number.
      */}
      {data ? (
        <>
          <SectionLabel icon={Users}>Audience</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TRAFFIC_METRICS.map((m) => (
              <MetricCard key={m.id} spec={m} summary={data} />
            ))}
          </div>

          <SectionLabel icon={Download}>Downloads</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {DOWNLOAD_METRICS.map((m) => (
              <MetricCard key={m.id} spec={m} summary={data} />
            ))}
          </div>
        </>
      ) : null}

      {/* Trend chart */}
      <TrendChart buckets={data?.timeseries.buckets ?? []} granularity={data?.timeseries.granularity ?? "hour"} />

      {/* Ad performance — the four headline numbers explained, then the zones. */}
      {data ? (
        <>
          <SectionLabel icon={DollarSign}>Advertising</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {AD_METRICS.map((m) => (
              <MetricCard key={m.id} spec={m} summary={data} />
            ))}
          </div>
        </>
      ) : null}
      <AdPerformance ads={data?.ads} />

      {/* Geography */}
      <div>
        <SectionLabel icon={Globe2}>Geography</SectionLabel>
        <GeoMap rows={data?.byCountry ?? []} />
      </div>

      {/*
        Engagement, as its own headline row (owner, 2026-09-02: "put a page
        viiew stat and chart in the revenue and engagement in admin dashboard
        along with other stats").

        Page views and a page-views chart already existed — a "Page views"
        metric card in the Audience row above, and a Page views toggle on the
        trend chart. Both default out of sight, which is presumably why they
        read as missing. Repeating the same number a fourth time would not have
        helped anybody find it.

        What genuinely was NOT here is the engagement framing of it: how many
        pages a session actually covers. Views alone cannot distinguish 10,000
        people reading one page from 1,000 reading ten, and those are different
        products. Every number below is derived from counts already on the
        summary — nothing new is queried, and nothing is modelled.
      */}
      {data ? (
        <>
          <SectionLabel icon={Eye}>Engagement</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={Eye} label="Page views" value={formatCompactNumber(data.pageViews)} accent="sky" raw />
            <Stat
              icon={TrendingUp}
              label="Pages per session"
              /*
                Sessions can legitimately be 0 on a quiet window, and dividing by
                it would print Infinity or NaN on the dashboard. An em-dash says
                "not measurable yet", which is the truth.
              */
              value={data.sessions > 0 ? (data.pageViews / data.sessions).toFixed(1) : "—"}
              accent="indigo"
              raw
            />
            <Stat icon={Users} label="Bounce rate" value={`${data.bounceRatePct}%`} accent="amber" raw />
            <Stat
              icon={TrendingUp}
              label="Avg. time on page"
              value={data.avgTimeOnPageSec > 0 ? `${Math.round(data.avgTimeOnPageSec)}s` : "—"}
              accent="emerald"
              raw
            />
          </div>
        </>
      ) : null}

      {/* Engagement + breakdowns */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownCard icon={TrendingUp} title="Top platforms" rows={data?.topPlatforms ?? []} />
          <BreakdownCard icon={MonitorSmartphone} title="Device" rows={data?.byDevice ?? []} />
          <BreakdownCard icon={Globe2} title="Browser" rows={data?.byBrowser ?? []} />
          {/* Operating system and region were listed by the owner and had no
              card at all — the data was always collected, never surfaced. */}
          <BreakdownCard icon={Server} title="Operating system" rows={data?.byOs ?? []} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownCard icon={Globe2} title="Region" rows={data?.byRegion ?? []} />
          <BreakdownCard icon={Eye} title="Top pages" rows={data?.engagement.topPages ?? []} />
          <BreakdownCard icon={Globe2} title="Referrers" rows={data?.engagement.topReferrers ?? []} />
          {/* Search grouped by ENGINE — Google alone arrives as a dozen country
              domains, so it never surfaced in the raw referrer list. */}
          <BreakdownCard icon={Search} title="Search engines" rows={data?.engagement.searchEngines ?? []} />
          <NewReturningCard newV={data?.engagement.newVisitors ?? 0} ret={data?.engagement.returningVisitors ?? 0} />
        </div>
      </div>

      {/*
        🔴 DOWNLOAD HISTORY HAS MOVED OUT (owner, 2026-08-25: "put download
        history in it own section in traffic with a top nav, so i can easily
        located download history in traffic section").

        It lived here from 2026-08-09 as the drill-down FROM the aggregate
        numbers above ("success rate dipped" → "which ones failed?"), which is
        still a fair reading — but it meant the table was only reachable by
        scrolling this entire live dashboard, and the owner could not find it.
        It is now its own tab on the Traffic panel
        (`features/admin/download-history-panel.tsx`), one tap from anywhere in
        the section, with its own range control and the Downloads CSV export
        that belongs to it.
      */}

      {/* Every page — including the ones nobody visited */}
      <div>
        <SectionLabel icon={Eye}>Pages</SectionLabel>
        <PagesTable rows={data?.engagement.pages ?? []} />
      </div>

      {/* Monitoring */}
      <Monitoring data={data} />

      <p className="px-1 text-[11px] text-muted-foreground">
        {empty
          ? "No analytics yet — this fills in as traffic flows."
          : `Updated ${data ? new Date(data.generatedAt).toLocaleTimeString() : "…"}${data?.approxBreakdowns ? " · breakdowns sampled" : ""}${
              live ? " · streaming live" : ""
            }.`}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ cards */

const ACCENTS: Record<string, string> = {
  emerald: "from-emerald-500/15 to-teal-500/15 text-emerald-500 ring-emerald-500/20",
  blue: "from-blue-500/15 to-indigo-500/15 text-blue-500 ring-blue-500/20",
  violet: "from-violet-500/15 to-purple-500/15 text-violet-500 ring-violet-500/20",
  cyan: "from-cyan-500/15 to-sky-500/15 text-cyan-500 ring-cyan-500/20",
  fuchsia: "from-fuchsia-500/15 to-pink-500/15 text-fuchsia-500 ring-fuchsia-500/20",
  amber: "from-amber-500/15 to-orange-500/15 text-amber-500 ring-amber-500/20",
  green: "from-green-500/15 to-emerald-500/15 text-green-500 ring-green-500/20",
  rose: "from-rose-500/15 to-red-500/15 text-rose-500 ring-rose-500/20",
};

function Stat({
  icon: Icon,
  label,
  value,
  accent,
  raw,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent: string;
  raw?: boolean;
}) {
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

function SectionLabel({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h4 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </h4>
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

/**
 * Every catalogued surface and its traffic, grouped.
 *
 * Unlike "Top pages" (a top-8 tally that hides everything below it), this
 * reports the WHOLE app: a page with no views shows a zero rather than being
 * absent, which is the only way the dashboard can answer "is anyone using this?"
 * — the question the owner asked of Wallpapers.
 *
 * Bars are scaled to the busiest page so the shape is readable at a glance;
 * counts are the real numbers, never rounded up.
 */
function PagesTable({ rows }: { rows: PageStat[] }) {
  const groups = rows.reduce<Record<string, PageStat[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});
  const max = Math.max(1, ...rows.map((r) => r.views));
  const total = rows.reduce((sum, r) => sum + r.views, 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-xs text-muted-foreground shadow-sm">
        No page views yet — this fills in as traffic flows.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {rows.length} pages tracked
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{formatCompactNumber(total)} views</span>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <p className="sticky top-0 z-10 bg-secondary/70 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground backdrop-blur">
              {group}
            </p>
            <ul className="divide-y divide-border/50">
              {items.map((r) => (
                <li key={r.id} className="px-3.5 py-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className={cn("truncate font-medium", r.views === 0 && "text-muted-foreground")}>{r.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatCompactNumber(r.views)}
                      <span className="ml-1.5 opacity-70">· {formatCompactNumber(r.visitors)} visitors</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                      style={{ width: `${(r.views / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewReturningCard({ newV, ret }: { newV: number; ret: number }) {
  const total = Math.max(1, newV + ret);
  const newPct = Math.round((newV / total) * 100);
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> New vs returning
      </h4>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${newPct}%` }} />
        <div className="h-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${100 - newPct}%` }} />
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
        <div>
          <p className="text-lg font-extrabold tabular-nums text-emerald-500">{formatCompactNumber(newV)}</p>
          <p className="text-[11px] text-muted-foreground">New ({newPct}%)</p>
        </div>
        <div>
          <p className="text-lg font-extrabold tabular-nums text-blue-500">{formatCompactNumber(ret)}</p>
          <p className="text-[11px] text-muted-foreground">Returning ({100 - newPct}%)</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ trend */

const METRICS: { key: keyof Pick<TimeBucket, "visitors" | "pageViews" | "downloads">; label: string; color: string }[] = [
  { key: "visitors", label: "Visitors", color: "from-blue-500 to-indigo-500" },
  { key: "pageViews", label: "Page views", color: "from-cyan-500 to-sky-500" },
  { key: "downloads", label: "Downloads", color: "from-fuchsia-500 to-pink-500" },
];

function TrendChart({ buckets, granularity }: { buckets: TimeBucket[]; granularity: "hour" | "day" }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("visitors");
  const active = METRICS.find((m) => m.key === metric) ?? METRICS[0]!;
  const values = buckets.map((b) => b[metric]);
  const max = Math.max(1, ...values);
  const fmt = (iso: string) =>
    granularity === "hour"
      ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Trend
        </h4>
        <div className="inline-flex rounded-lg bg-secondary/60 p-0.5 ring-1 ring-inset ring-border/40">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                tap();
                setMetric(m.key);
              }}
              aria-pressed={metric === m.key}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition active:scale-[0.96]",
                metric === m.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {buckets.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-[3px]">
            {buckets.map((b) => {
              const v = b[metric];
              const h = Math.max(2, (v / max) * 100);
              return (
                <div
                  key={b.t}
                  className={cn("flex-1 rounded-t bg-gradient-to-t transition-[height] duration-300", active.color)}
                  style={{ height: `${h}%`, minWidth: 2 }}
                  title={`${fmt(b.t)} · ${v.toLocaleString()} ${active.label.toLowerCase()}`}
                />
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{buckets[0] ? fmt(buckets[0].t) : ""}</span>
            <span>{buckets[buckets.length - 1] ? fmt(buckets[buckets.length - 1]!.t) : ""}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ads */

function AdPerformance({ ads }: { ads: AnalyticsSummary["ads"] | undefined }) {
  const [cpm, setCpm] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ads && cpm === "") setCpm(String(ads.cpmUsd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads?.cpmUsd]);

  const saveCpm = async () => {
    const v = Number(cpm);
    if (!Number.isFinite(v) || v < 0) return;
    setSaving(true);
    setSaved(false);
    tap();
    try {
      const res = await fetch(`/api/admin/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpmUsd: v }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const maxZone = Math.max(1, ...(ads?.byZone ?? []).map((z) => z.impressions));

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel icon={DollarSign}>Ad performance</SectionLabel>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Est. CPM $</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={cpm}
            onChange={(e) => setCpm(e.target.value)}
            className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs tabular-nums"
          />
          <button
            type="button"
            onClick={saveCpm}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold text-background transition active:scale-[0.96] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/*
        The four headline ad numbers are NOT repeated here — they are the
        explained MetricCards above, with their trend and their measurement
        note. This block keeps only what those cards cannot show: the CPM input
        that drives the revenue estimate, and the per-placement split.
      */}
      {ads && ads.byZone.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">By placement</p>
          <ul className="space-y-1.5">
            {ads.byZone.map((z: AdZoneStat) => (
              <li key={z.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate font-medium">{z.key.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCompactNumber(z.impressions)} imp · {formatCompactNumber(z.clicks)} clk · {z.ctr}% · ${z.revenueUsd.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${(z.impressions / maxZone) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">Revenue is an estimate at ${ads.cpmUsd}/1,000 impressions — set your real CPM above.</p>
        </div>
      ) : (
        <p className="mt-3 text-center text-xs text-muted-foreground">No ad activity in this range yet.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ monitoring */

function Monitoring({ data }: { data: AnalyticsSummary | null }) {
  const m = data?.monitoring;
  const errRate = m?.errorRatePct ?? 0;
  const tone = errRate >= 20 ? "rose" : errRate >= 5 ? "amber" : "green";
  return (
    <div>
      <SectionLabel icon={Server}>Monitoring</SectionLabel>
      <div className="grid gap-3 lg:grid-cols-3">
        <Stat icon={AlertTriangle} label="Download error rate" value={`${errRate}%`} accent={tone} raw />
        <Stat icon={Ban} label="Failed downloads" value={m?.failedDownloads ?? 0} accent="rose" />
        <Stat icon={TrendingUp} label="Success rate" value={data ? `${data.downloads.successRate}%` : "—"} accent="emerald" raw />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <FeedCard icon={AlertTriangle} title="Recent errors" rows={m?.recentErrors ?? []} tone="rose" emptyLabel="No errors — all downloads succeeded." />
        <FeedCard icon={ShieldAlert} title="Security events" rows={m?.recentSecurity ?? []} tone="amber" emptyLabel="No recent security events." />
      </div>
    </div>
  );
}

function FeedCard({
  icon: Icon,
  title,
  rows,
  tone,
  emptyLabel,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  rows: MonitorRow[];
  tone: "rose" | "amber";
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", tone === "rose" ? "text-rose-500" : "text-amber-500")} /> {title}
      </h4>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium capitalize">{r.label}</p>
                {r.detail ? <p className="truncate text-[11px] text-muted-foreground">{r.detail}</p> : null}
              </div>
              <time className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">{new Date(r.at).toLocaleTimeString()}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- export */

/* Exported so `download-history-panel.tsx` can reuse it: the CSV export for the
   download log moved to that tab along with the table it exports, and a second
   copy of this button would be a second place to fix a broken export URL. */
export function ExportButton({ range, type, label }: { range: TabRange; type: "events" | "downloads"; label: string }) {
  return (
    <a
      href={`/api/admin/analytics/export?range=${range}&type=${type}`}
      onClick={tap}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-secondary active:scale-[0.96]"
    >
      <FileDown className="h-3.5 w-3.5" /> {label}
    </a>
  );
}
