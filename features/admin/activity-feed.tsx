"use client";

import { useEffect, useRef, useState } from "react";

import type { ActivityItem } from "@/lib/admin/activity";
import { cn } from "@/lib/utils";

/**
 * Live activity feed — every notable event as it lands, including anonymous.
 *
 * Honest to the architecture: events are LOGGED, not pushed, so this polls
 * `/api/admin/activity?since=…` every few seconds and prepends what's new. No
 * websocket pretence, no per-event push spam. The pulse dot shows it's polling.
 */

const POLL_MS = 6000;
const MAX_ITEMS = 100;

const DOT: Record<string, string> = {
  download: "bg-blue-500",
  ad_click: "bg-amber-500",
  ad_impression: "bg-amber-400/70",
  affiliate_click: "bg-fuchsia-500",
  subscribe: "bg-green-500",
  subscribe_cancel: "bg-red-500",
  upgrade_prompt_view: "bg-violet-500",
  pwa_installed: "bg-cyan-500",
  api_key_created: "bg-slate-400",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityFeed({ initial }: { initial: ActivityItem[] }) {
  const [items, setItems] = useState<ActivityItem[]>(initial);
  const [live, setLive] = useState(true);
  // Newest timestamp we've seen — the incremental cursor.
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
            sinceRef.current = fresh[0]!.at;
            setItems((prev) => {
              const seen = new Set(prev.map((i) => i.id));
              const added = fresh.filter((i) => !seen.has(i.id));
              return [...added, ...prev].slice(0, MAX_ITEMS);
            });
          }
          setLive(true);
        } else {
          setLive(false);
        }
      } catch {
        if (alive) setLive(false);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Live activity</h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", live ? "animate-pulse bg-green-500" : "bg-muted-foreground/40")} />
          {live ? "live" : "paused"}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activity yet. Downloads, ad clicks, subscriptions and installs appear here as they
          happen — including from signed-out visitors.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[item.kind] ?? "bg-muted-foreground/50")} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{item.actor ? item.actor.displayName : "Anonymous"}</span>{" "}
                <span className="text-muted-foreground">{item.label.toLowerCase()}</span>
                {item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground/70">{timeAgo(item.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
