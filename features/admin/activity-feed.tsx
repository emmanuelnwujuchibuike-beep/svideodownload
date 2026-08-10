"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ActivityItem, ActivityTotals, MetricTotals } from "@/lib/admin/activity";
import { cn, formatCompactNumber } from "@/lib/utils";

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
  Two and a half seconds, down from six.

  The feed is a live operations view — an operator watching it is watching for
  something specific to appear, and six seconds is long enough to make them
  reload the page instead, which costs far more than the poll does. The request
  is incremental (a timestamp cursor, usually returning nothing), so the extra
  frequency is a few hundred bytes rather than a query of the whole table.
*/
const POLL_MS = 2500;
const MAX_ITEMS = 100;

interface KindMeta {
  label: string;
  dot: string;
  chip: string;
}

const KIND: Record<string, KindMeta> = {
  download: { label: "Download", dot: "bg-blue-500", chip: "bg-blue-500/12 text-blue-600 dark:text-blue-300" },
  ad_click: { label: "Ad click", dot: "bg-amber-500", chip: "bg-amber-500/12 text-amber-600 dark:text-amber-300" },
  ad_impression: { label: "Impression", dot: "bg-amber-400/70", chip: "bg-amber-400/12 text-amber-600 dark:text-amber-300" },
  affiliate_click: { label: "Affiliate", dot: "bg-fuchsia-500", chip: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300" },
  subscribe: { label: "Subscribe", dot: "bg-green-500", chip: "bg-green-500/12 text-green-600 dark:text-green-300" },
  subscribe_cancel: { label: "Cancel", dot: "bg-red-500", chip: "bg-red-500/12 text-red-600 dark:text-red-300" },
  upgrade_prompt_view: { label: "Upgrade view", dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  pwa_installed: { label: "Install", dot: "bg-cyan-500", chip: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300" },
  api_key_created: { label: "API key", dot: "bg-slate-400", chip: "bg-slate-400/15 text-slate-600 dark:text-slate-300" },
};

function metaFor(kind: string): KindMeta {
  return KIND[kind] ?? { label: kind.replace(/_/g, " "), dot: "bg-muted-foreground/50", chip: "bg-secondary text-muted-foreground" };
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

export function ActivityFeed({ initial, totals }: { initial: ActivityItem[]; totals?: ActivityTotals | null }) {
  const [items, setItems] = useState<ActivityItem[]>(() => dedupe(initial));
  const [live, setLive] = useState(true);
  const sinceRef = useRef<string | null>(initial[0]?.at ?? null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const url = sinceRef.current
          ? `/api/admin/activity?since=${encodeURIComponent(sinceRef.current)}`
          : "/api/admin/activity";
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const { items: fresh } = (await res.json()) as { items: ActivityItem[] };
          if (alive && fresh.length > 0) {
            setItems((prev) => {
              const merged = dedupe([...fresh, ...prev]).slice(0, MAX_ITEMS);
              sinceRef.current = merged[0]?.at ?? sinceRef.current;
              return merged;
            });
          }
          if (alive) setLive(true);
        } else if (alive) {
          setLive(false);
        }
      } catch {
        if (alive) setLive(false);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };

    /*
      🔴 Poll IMMEDIATELY, then on an interval (owner, 2026-08-10: the feed
      "doesn't update instantly, in real time").

      The first fetch used to wait a full interval. Opening the dashboard meant
      staring at server-rendered rows for six seconds before anything could
      arrive — and since that page is the thing an operator opens BECAUSE
      something is happening, the first six seconds are the ones that matter
      most. There is no cost to asking straight away: the request is small and
      the cursor makes it incremental.
    */
    void tick();

    /*
      🔴 And catch up the moment the tab comes back.

      A background tab is throttled hard by every browser — timers can be
      clamped to once a minute or stopped entirely — so switching away and back
      previously showed a feed that was minutes stale and only corrected on the
      next tick. Now returning to the tab fetches at once, and because the
      cursor is a timestamp rather than a page number, that single request
      carries everything missed while away rather than only the newest few.
    */
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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
              <li key={item.id} className="flex items-start gap-3 rounded-xl px-1 py-2.5 text-sm">
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
