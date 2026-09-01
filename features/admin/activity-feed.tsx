"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { Repeat, UserPlus } from "lucide-react";

import type { ActivityItem, ActivityTotals, MetricTotals } from "@/lib/admin/activity";
import { cn, formatCompactNumber } from "@/lib/utils";

import { adminJson, useAdminLive } from "./live/use-admin-live";

/**
 * Live activity feed — every notable event as it lands, including anonymous.
 *
 * Honest to the architecture: events are LOGGED, not pushed, so this polls
 * `/api/admin/activity?since=…` every few seconds and prepends what's new. No
 * websocket pretence. The pulse dot shows it's polling.
 *
 * ── Responsive + de-duplicated (owner, 2026-08-03) ────────────────────────────
 * Rebuilt to be mobile-first: the period stats are cards that stack on a phone
 * instead of a table that scrolls sideways, and each row wraps its detail rather
 * than truncating to nothing on a narrow screen. Duplicates are collapsed two
 * ways — by id, and by a content signature (same kind + actor + detail within the
 * same second) — so a download logged twice never shows twice.
 */

/*
  🔴 THE 2.5-SECOND POLL IS GONE (owner, 2026-08-30: Vercel had eaten $15 of a
  $20 monthly credit against ~90–100 daily users, with this dashboard left open
  for hours).

  The old note here argued that a 2.5s incremental poll is cheap because the
  response is usually empty. The response is — the REQUEST is not. Every one of
  those 1,440 hits an hour ran the full admin guard, and `getAdminUser`
  deliberately re-reads the role from the database on every call so a demoted
  admin loses access immediately. So the cost was one Vercel invocation plus an
  auth round trip plus a role query, 1,440 times an hour, to learn "nothing new"
  about 1,400 of those times. And the recursive `setTimeout` did not stop when
  the tab was hidden — only the browser's own background throttling slowed it.

  It now runs through the shared admin scheduler at the `live` tier (15s),
  stopped entirely while the tab is hidden and backed off on failure. Fifteen
  seconds is still a live operations view; 2.5s was paying ~6× for a difference
  an operator cannot act on.
*/
/*
  Code-split: the detail panel only ever renders after a row is TAPPED, so its
  bytes have no business in the admin dashboard-s first load. /admin is held to
  a global ceiling (lib/perf/budget.test.ts) and this is exactly the kind of
  on-demand panel that ceiling exists to keep out — the same pattern the
  downloader detail sheet already uses.
*/
const ActivityDetail = dynamic(
  () => import("./activity-detail").then((m) => m.ActivityDetail),
  { ssr: false },
);

const MAX_ITEMS = 100;
const ACTIVITY_KEY = "admin:activity";

interface KindMeta {
  label: string;
  dot: string;
  chip: string;
}

/*
  The three monetization tones, named once and shared.

  Every ad row is one of: an impression, a click, or a diagnostic. Spelling the
  same two long Tailwind strings out per event duplicated them eight times and
  pushed /admin past its gzipped budget; naming them also makes the rule visible
  — an ExoClick impression is styled identically to an AdSense one because it is
  worth the same, and no-fills are deliberately quiet because they are not
  revenue. Written as literals so Tailwind's scanner still sees every class.
*/
const IMPRESSION = { dot: "bg-amber-400/70", chip: "bg-amber-400/12 text-amber-600 dark:text-amber-300" } as const;
const CLICK = { dot: "bg-amber-500", chip: "bg-amber-500/12 text-amber-600 dark:text-amber-300" } as const;
/** Diagnostics — a slot that was asked for and came back empty. Not earnings. */
const QUIET = { dot: "bg-muted-foreground/40", chip: "bg-secondary text-muted-foreground" } as const;

const KIND: Record<string, KindMeta> = {
  download: { label: "Download", dot: "bg-blue-500", chip: "bg-blue-500/12 text-blue-600 dark:text-blue-300" },
  ad_click: { label: "Ad click", ...CLICK },
  ad_impression: { label: "Impression", ...IMPRESSION },
  affiliate_click: { label: "Affiliate", dot: "bg-fuchsia-500", chip: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300" },
  subscribe: { label: "Subscribe", dot: "bg-green-500", chip: "bg-green-500/12 text-green-600 dark:text-green-300" },
  subscribe_cancel: { label: "Cancel", dot: "bg-red-500", chip: "bg-red-500/12 text-red-600 dark:text-red-300" },
  upgrade_prompt_view: { label: "Upgrade view", dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  pwa_installed: { label: "Install", dot: "bg-cyan-500", chip: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300" },
  api_key_created: { label: "API key", dot: "bg-slate-400", chip: "bg-slate-400/15 text-slate-600 dark:text-slate-300" },
  /*
    🔴 ExoClick display placements are IMPRESSIONS AND CLICKS, and must read as
    such (owner, 2026-08-31: "the ad activity in admin dashboard suppose to be
    impression and click, not banner fill in gray").

    These had no entry at all, so `metaFor` fell through to its default — the
    raw event id with the underscores swapped for spaces, on the muted chip.
    That is where "banner filled", in grey, came from: not a decision, an
    absence. An ExoClick impression is worth exactly what an AdSense one is, so
    it gets the same amber the `ad_impression` row already uses, and the click
    gets the stronger amber `ad_click` uses.

    The no-fills stay deliberately quiet — they are diagnostics, not revenue,
    and colouring them like earnings would misreport an empty slot as a filled
    one. They keep the muted chip ON PURPOSE, which is the opposite of the
    accident above.
  */
};

/**
 * ExoClick display placements — `banner_*` and `interstitial_*`.
 *
 * ONE RULE rather than six near-identical KIND rows, which is both smaller (the
 * six entries pushed /admin past its gzipped ceiling) and truer: every one of
 * these events is an impression, a click, or a no-fill, and the suffix already
 * says which.
 *
 * The label says WHAT happened; the DETAIL column already says which placement
 * ("Bottom banner · /history", "Full-page interstitial · /"). Spelling the
 * placement into the label too gave "Banner impression · Bottom banner" — the
 * same word twice on one row. Reusing the AdSense row's exact "Impression"
 * string is deliberate: the two are worth the same and should scan as one
 * column.
 */
function displayAdMeta(kind: string): KindMeta | null {
  if (!kind.startsWith("banner_") && !kind.startsWith("interstitial_")) return null;
  if (kind.endsWith("_click")) return { label: "Click", ...CLICK };
  // No-fills stay muted ON PURPOSE — a slot that came back empty is a
  // diagnostic, and colouring it like earnings would report a blank as revenue.
  if (kind.endsWith("_empty")) return { label: "No-fill", ...QUIET };
  return { label: "Impression", ...IMPRESSION };
}

function metaFor(kind: string): KindMeta {
  return (
    KIND[kind] ??
    displayAdMeta(kind) ??
    { label: kind.replace(/_/g, " "), dot: "bg-muted-foreground/50", chip: "bg-secondary text-muted-foreground" }
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** A content signature to collapse the same action logged twice within one second. */
function signature(i: ActivityItem): string {
  return `${i.kind}|${i.actor?.handle ?? "anon"}|${i.detail ?? ""}|${i.at.slice(0, 19)}`;
}

/** Dedup by id first, then collapse identical-signature rows, keeping the newest. */
function dedupe(items: ActivityItem[]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const i of items) if (!byId.has(i.id)) byId.set(i.id, i);
  const bySig = new Map<string, ActivityItem>();
  for (const i of byId.values()) {
    const sig = signature(i);
    const existing = bySig.get(sig);
    if (!existing || i.at > existing.at) bySig.set(sig, i);
  }
  return [...bySig.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function ActivityFeed({
  initial,
  totals,
}: {
  initial: ActivityItem[];
  totals?: ActivityTotals | null;
}) {
  const [items, setItems] = useState<ActivityItem[]>(() => dedupe(initial));
  /** The row whose full payload is open, if any. */
  const [detail, setDetail] = useState<ActivityItem | null>(null);
  const sinceRef = useRef<string | null>(initial[0]?.at ?? null);

  /*
    The cursor is what makes a slower poll lossless. `?since=` is a TIMESTAMP,
    not a page number, so one request after any gap — a slow tick, a hidden tab,
    a backed-off failure — carries everything that happened in that gap rather
    than only the newest few. That is why dropping from 2.5s to 15s costs the
    operator no events, only latency.

    The scheduler's own catch-up sweep on `visibilitychange` replaces the
    hand-rolled one that used to live here (owner, 2026-08-10: a backgrounded
    tab showed a stale feed), so returning to the tab still resyncs at once.
  */
  const { data, error } = useAdminLive<{ items: ActivityItem[] }>({
    key: ACTIVITY_KEY,
    tier: "live",
    fetcher: () =>
      adminJson<{ items: ActivityItem[] }>(
        sinceRef.current
          ? `/api/admin/activity?since=${encodeURIComponent(sinceRef.current)}`
          : "/api/admin/activity",
      ),
  });

  useEffect(() => {
    const fresh = data?.items;
    if (!fresh || fresh.length === 0) return;
    setItems((prev) => {
      const merged = dedupe([...fresh, ...prev]).slice(0, MAX_ITEMS);
      sinceRef.current = merged[0]?.at ?? sinceRef.current;
      return merged;
    });
  }, [data]);

  const live = error === null;

  // Live breakdown of what's currently in view, by kind — the "clear stats".
  const breakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
    return [...m.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
  }, [items]);

  return (
    <section className="rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold">Live activity</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", live ? "animate-pulse bg-green-500" : "bg-muted-foreground/40")} />
          {live ? "live" : "paused"}
        </span>
      </div>

      {/* Real period totals — a Postgres count per cell, never an estimate. */}
      {totals ? <TotalsCards totals={totals} /> : null}
      {totals?.visitorsToday ? <TodaySplitCard split={totals.visitorsToday} /> : null}

      {/* What's on screen right now, by kind. */}
      {breakdown.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {breakdown.map(({ kind, count }) => {
            const meta = metaFor(kind);
            return (
              <span key={kind} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", meta.chip)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                {meta.label}
                <span className="tabular-nums opacity-80">{count}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activity yet. Downloads, ad clicks, subscriptions and installs appear here as they
          happen — including from signed-out visitors.
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-border/50">
          {items.map((item) => {
            const meta = metaFor(item.kind);
            return (
              <li key={item.id}>
                {/*
                  🔴 A BUTTON, not a static row (owner, 2026-08-31: clicking a
                  live activity "doesnt show anything, it should show all
                  details and information of each"). The whole row is the target
                  — an operator on a phone should not have to find a chevron.
                */}
                <button
                  type="button"
                  onClick={() => setDetail(item)}
                  className="flex w-full items-start gap-3 rounded-xl px-1 py-2.5 text-left text-sm transition hover:bg-secondary/50"
                >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", meta.chip)}>
                      {meta.label}
                    </span>
                    <span className="font-medium">{item.actor ? item.actor.displayName : "Anonymous"}</span>
                    {item.actor ? <span className="text-xs text-muted-foreground">@{item.actor.handle}</span> : null}
                  </div>
                  {item.detail ? <p className="mt-0.5 break-words text-[13px] leading-snug text-muted-foreground">{item.detail}</p> : null}
                </div>
                <time
                  dateTime={item.at}
                  title={new Date(item.at).toLocaleString()}
                  className="mt-0.5 shrink-0 whitespace-nowrap text-xs text-muted-foreground/70"
                >
                  {timeAgo(item.at)}
                </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Rendered only while open — it portals itself, so the blurred admin
          chrome cannot clip it (the standing fixed-overlay law). */}
      {detail ? <ActivityDetail item={detail} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

/**
 * "Which guest came back today, and which is brand new" (owner, 2026-08-16).
 * Sourced from the `analytics_visitor_split` RPC (migration 0115) — a visitor
 * counts as RETURNING today if their first-ever recorded event predates today,
 * NEW if today IS their first event. Both figures count today's active
 * visitors only, signed-in and anonymous alike; they are not the same count
 * as "new signed-up users" elsewhere on the dashboard.
 */
function TodaySplitCard({ split }: { split: { newToday: number; returningToday: number } }) {
  const total = split.newToday + split.returningToday;
  const returningPct = total > 0 ? Math.round((split.returningToday / total) * 100) : 0;
  return (
    <div className="mb-4 rounded-2xl border border-border/60 bg-secondary/25 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-500">Today — new vs. returning</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2">
          <UserPlus className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-extrabold leading-tight tabular-nums">{formatCompactNumber(split.newToday)}</p>
            <p className="text-[10px] text-muted-foreground">New visitors</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-background/60 px-3 py-2">
          <Repeat className="h-4 w-4 shrink-0 text-blue-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-extrabold leading-tight tabular-nums">{formatCompactNumber(split.returningToday)}</p>
            <p className="text-[10px] text-muted-foreground">Returning · {returningPct}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}


const PERIODS: { key: keyof MetricTotals; label: string }[] = [
  { key: "day", label: "24h" },
  { key: "week", label: "7d" },
  { key: "month", label: "30d" },
  { key: "year", label: "1y" },
];

/**
 * Downloads / impressions / ad clicks over rolling 24h · 7d · 30d · 365d.
 * One card per metric, each with the four windows in a 2×2 (phone) → 1×4 (wider)
 * grid — no sideways-scrolling table on a small screen.
 */
function TotalsCards({ totals }: { totals: ActivityTotals }) {
  const cards: { label: string; data: MetricTotals; tint: string; ring: string }[] = [
    { label: "Downloads", data: totals.downloads, tint: "text-blue-500", ring: "ring-blue-500/20" },
    { label: "Impressions", data: totals.impressions, tint: "text-amber-500", ring: "ring-amber-500/20" },
    { label: "Ad clicks", data: totals.adClicks, tint: "text-fuchsia-500", ring: "ring-fuchsia-500/20" },
  ];
  return (
    <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className={cn("rounded-2xl border border-border/60 bg-secondary/25 p-3 ring-1 ring-inset", c.ring)}>
          <p className={cn("mb-2 text-xs font-bold uppercase tracking-wide", c.tint)}>{c.label}</p>
          <div className="grid grid-cols-4 gap-1">
            {PERIODS.map((p) => (
              <div key={p.key} className="rounded-lg bg-background/60 px-1.5 py-1.5 text-center">
                <p className="text-sm font-extrabold tabular-nums leading-tight">{formatCompactNumber(c.data[p.key])}</p>
                <p className="text-[10px] text-muted-foreground">{p.label}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
