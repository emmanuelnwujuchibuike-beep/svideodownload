"use client";

import { Play } from "lucide-react";

import { openPlayer } from "@/features/downloads/player-store";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { formatBytes } from "@/lib/utils";

/** "Continue Watching" — live download tasks (real progress) + recent downloads. */
export function ContinueWatching() {
  const { tasks } = useDownloadManager();
  const { items } = useHistory();

  const active = tasks.filter((t) => t.status === "downloading" || t.status === "paused");
  const recent = items.filter((r) => r.kind === "video").slice(0, 6);

  if (active.length === 0 && recent.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-foreground">🕒 Continue Watching</h2>
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

        {recent.map((r) => {
          const Brand = BRAND_ICONS[r.platform];
          return (
            <button key={r.id} type="button" onClick={() => openPlayer(r)} className="group w-60 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card text-left shadow-soft transition hover:shadow-card">
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
