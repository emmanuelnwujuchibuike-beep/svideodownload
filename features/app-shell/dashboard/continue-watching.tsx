"use client";

import { ChevronRight, Clock, EyeOff, Play } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { useHomeModules } from "@/features/app-shell/dashboard/home-modules-store";
import { hasMedia, mediaKey, warmMediaCache } from "@/features/downloads/local-media";
import { openPlayerQueue } from "@/features/downloads/player-store";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { haptic } from "@/lib/motion/haptics";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { formatBytes } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

/**
 * "Continue Watching" — live download tasks (real progress) + recent
 * downloads.
 *
 * Shown by default (owner, 2026-07-16: "let the continue watching show on
 * default and make a way users can turn it off"), with its own visible hide
 * control here on the module. An inline hide switch existed once and was
 * removed after three of four accounts ended up with this exact module hidden
 * — but the real defect then was that hiding had NO visible way back, so an
 * accidental tap was permanent-looking. That's fixed at the root now: hiding
 * from here drops a labelled restore chip into the same spot in the same
 * frame, and restoring is equally instant (see home-modules-store.tsx). One tap
 * out, one tap back.
 */
export function ContinueWatching() {
  const { tasks } = useDownloadManager();
  const { items } = useHistory();
  const { hide } = useHomeModules();

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
        <div className="flex items-center gap-2.5">
          <ModuleIconBadge icon={Clock} className="h-9 w-9 rounded-2xl" />
          <div>
            <h2 className="text-base font-bold leading-tight text-foreground">Continue Watching</h2>
            <p className="text-xs text-muted-foreground">Pick up where you left off</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/downloads"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 py-1.5 pl-3 pr-2 text-sm font-semibold text-primary transition hover:bg-primary/15"
          >
            View All <ChevronRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => {
              haptic("selection");
              hide("continue_watching");
            }}
            aria-label="Hide Continue Watching"
            title="Hide Continue Watching"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <EyeOff className="h-4 w-4" />
          </button>
        </div>
      </div>
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
    </section>
  );
}
