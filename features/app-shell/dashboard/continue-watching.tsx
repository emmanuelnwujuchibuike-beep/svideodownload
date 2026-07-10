"use client";

import { Clock, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { Switch } from "@/components/ui/switch";
import { hasMedia, mediaKey, warmMediaCache } from "@/features/downloads/local-media";
import { openPlayerQueue } from "@/features/downloads/player-store";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { formatBytes } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

/**
 * "Continue Watching" — live download tasks (real progress) + recent
 * downloads. Carries its own on/off switch (owner ask): tapping it off
 * collapses the rail immediately and persists via `hideModule` — a surgical,
 * race-safe PATCH (see /api/home-preferences) rather than resending a
 * client-computed full `hiddenModules` array, which could clobber a
 * concurrent change made from Friend Activity's own switch or the account
 * Home Modules Editor. Turning it back on works the same way in reverse, so
 * this never needs a trip to Settings unlike a one-way dismiss would.
 */
export function ContinueWatching() {
  const { tasks } = useDownloadManager();
  const { items } = useHistory();
  const [on, setOn] = useState(true);

  const toggle = () => {
    const next = !on;
    setOn(next);
    void fetch("/api/home-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next ? { showModule: "continue_watching" } : { hideModule: "continue_watching" }),
    }).catch(() => {});
  };

  const active = tasks.filter((t) => t.status === "downloading" || t.status === "paused");
  const recent = items.filter((r) => r.kind === "video").slice(0, 6);

  // Load videos AHEAD of time — the same instant-open contract Reels and
  // Stories already have — instead of only fetching once a tap opens the
  // player (which is what made "opening" visibly show a network load).
  // `warmMediaCache` was previously only ever called once, right after a
  // fresh download completed — anything downloaded in an earlier session (or
  // tapped before that background fetch finished) was never actually warmed,
  // so re-opening it here always re-fetched over the network. Runs one at a
  // time (never floods bandwidth) and only for entries not already cached;
  // `warmMediaCache` itself still skips entirely on Data Saver / a slow
  // connection, so this never costs a constrained viewer anything.
  useEffect(() => {
    if (recent.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const r of recent) {
        if (cancelled) return;
        const key = mediaKey(r.url, r.formatId, r.kind);
        if (await hasMedia(key)) continue;
        await warmMediaCache({ url: r.url, formatId: r.formatId, kind: r.kind, title: r.title });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the actual set of recent videos changes, not on every
    // render (`recent` is a fresh array each render even when its contents
    // haven't changed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent.map((r: DownloadRecord) => r.id).join(",")]);

  if (active.length === 0 && recent.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <ModuleIconBadge icon={Clock} /> Continue Watching
        </h2>
        <Switch checked={on} onChange={toggle} label="Show Continue Watching on Home" />
      </div>
      {!on ? null : (
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {active.map((t) => {
          const pct = t.totalBytes > 0 ? Math.min(100, Math.round((t.receivedBytes / t.totalBytes) * 100)) : 0;
          return (
            <div key={t.id} className="w-60 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
              <div className="relative aspect-video bg-neutral-800">
                {t.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 backdrop-blur"><Play className="h-4 w-4 fill-white text-white" /></span></span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-sm font-semibold text-foreground">{t.title}</p>
                <p className="text-[11px] text-muted-foreground">{formatBytes(t.receivedBytes)} / {t.totalBytes ? formatBytes(t.totalBytes) : "—"}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${pct}%` }} /></span>
                  <span className="text-[11px] font-semibold text-foreground">{pct}%</span>
                </div>
              </div>
            </div>
          );
        })}

        {recent.map((r, i) => {
          const Brand = BRAND_ICONS[r.platform];
          return (
            <button key={r.id} type="button" onClick={() => openPlayerQueue(recent, i)} className="group w-60 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card text-left shadow-soft transition hover:shadow-card">
              <div className="relative aspect-video bg-neutral-800">
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/25 backdrop-blur transition group-hover:bg-white/40"><Play className="h-4 w-4 fill-white text-white" /></span></span>
                {Brand ? <span className="absolute bottom-1.5 left-1.5 text-white/90"><Brand className="h-3.5 w-3.5" /></span> : null}
              </div>
              <div className="p-2.5">
                <p className="truncate text-sm font-semibold text-foreground">{r.title}</p>
                <p className="text-[11px] text-muted-foreground">{r.size ? formatBytes(r.size) : r.qualityLabel} · Downloaded</p>
              </div>
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}
