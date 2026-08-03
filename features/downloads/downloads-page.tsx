"use client";

import {
  Pause,
  Play,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useAppMode } from "@/features/app-shell/use-app-mode";
import { DownloadBox } from "@/features/downloads/download-box";
import { DownloadsRail } from "@/features/downloads/downloads-rail";
import {
  CloudStorageCard,
  DownloadQuickActions,
  DownloadStats,
  DownloadTrustStrip,
  DownloadsHero,
  RecentDownloads,
} from "@/features/downloads/downloads-sections";
import { HubWarmup } from "@/features/downloads/hub-warmup";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { MediaGallery } from "@/features/history/media-gallery";
import { AdSurface } from "@/features/monetization/ad-surface";
import { DownloadHistoryAd } from "@/features/monetization/download-history-ad";
import { DownloadInterstitial } from "@/features/monetization/download-interstitial";
import { ExitIntent } from "@/features/monetization/exit-intent";
import { TiredOfAds } from "@/features/monetization/tired-of-ads";
import { UsageDashboard } from "@/features/downloads/usage-dashboard";
import { WallpaperGallery } from "@/features/wallpapers/wallpaper-gallery";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { Wallpaper } from "@/lib/wallpapers";
import type { DownloadRecord, PlatformId } from "@/types";
import { cn, formatBytes } from "@/lib/utils";

const TABS = ["All", "Videos", "Reels", "Audios", "Images", "Files"] as const;
type Tab = (typeof TABS)[number];

const REEL_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "snapchat"];

function matchesTab(rec: DownloadRecord, tab: Tab): boolean {
  switch (tab) {
    case "All":
      return true;
    case "Videos":
      return rec.kind === "video" && !REEL_PLATFORMS.includes(rec.platform);
    case "Reels":
      return rec.kind === "video" && REEL_PLATFORMS.includes(rec.platform);
    case "Audios":
      return rec.kind === "audio";
    case "Images":
      return rec.kind === "image";
    case "Files":
      return false;
  }
}

export function DownloadsPage({ wallpapers }: { wallpapers: Wallpaper[] }) {
  const { items, toggleFavorite, removeDownload } = useHistory();
  const { tasks, pauseDownload, resumeDownload, retryDownload, cancelDownload, pauseAll } = useDownloadManager();

  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const mode = useAppMode();
  // The history section lives on THIS page only in Full Bleed (its nav has no
  // History tab). In Downloader mode the nav has a dedicated History page, so the
  // history is hidden here to avoid duplicating it (owner).
  const showHistory = mode !== "downloader";

  const active = tasks.filter((t) => t.status !== "completed" && t.status !== "canceled");

  // Filter by type-tab + search; the shared MediaGallery below owns the sort + view
  // (grid/list + column count), the same way the landing history does.
  const filtered = useMemo(() => {
    let list = items.filter((r) => matchesTab(r, tab));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.platformName.toLowerCase().includes(q));
    }
    return list;
  }, [items, tab, search]);

  return (
    <div className="space-y-5 pt-1">
      {/* The sticky top banner is mounted in the (app) layout (DownloadTopAd),
          not here — outside the page-transition template so its pin is reliable. */}

      {/* Warms the Gateway chunk and prefetches its destinations on idle, so
          nothing lags the first time it is needed. Renders nothing. */}
      <HubWarmup />

      {/* ── The owner's reference layout (public/new downloadpage.jpg), in order:
             hero → paste card → cloud storage → stat tiles → recent → quick
             actions → trust strip. Every figure below is computed from the
             viewer's real download history. ── */}

      <DownloadsHero />

      {/* Paste card. `id="download"` is the target the rail's "Download from
          Link" quick action points at — the anchor previously existed only on
          the landing hero, so that control did nothing on this page. */}
      <section id="download" className="scroll-mt-20 rounded-3xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
        <DownloadBox surface="card" />
      </section>

      {/* Under the paste card — adjusts to whatever ad size the zone serves
          (AdSurface hugs the unit). The site's highest-attention placement. */}
      <AdSurface zone="under_download" maxWidth="max-w-3xl" />

      <CloudStorageCard items={items} />

      <DownloadStats items={items} />

      <RecentDownloads items={items} onOpenAll={showHistory ? () => setTab("All") : undefined} />

      <DownloadQuickActions onFavorites={() => setTab("All")} />

      {/* Plan-aware storage detail: the usage breakdown, analytics, and the
          upgrade-or-clear gate. The headline meter now lives in the card above,
          so this is the detail behind it. */}
      <UsageDashboard />

      {/*
        The Hub proper: library on the left, panels on the right.

        One grid, two shapes. Below `xl` it is a single stacked column and the
        panels follow the library; at `xl` the second track appears and they
        become a sticky sidebar. The hero sits OUTSIDE this grid and spans the
        full width, because the paste bar is the primary action on every device
        and should never be squeezed into a column.
      */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0 space-y-5">
          {/* Filter tabs — history browsing, so Full Bleed only. */}
          {showHistory ? (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                    tab === t ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}

          {/* Downloading */}
          {active.length > 0 ? (
            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">Downloading ({active.length})</h2>
                <button type="button" onClick={pauseAll} className="text-xs font-semibold text-primary hover:underline">Pause all</button>
              </div>
              <div className="space-y-3">
                {active.map((t) => {
                  const pct = t.totalBytes > 0 ? Math.min(100, Math.round((t.receivedBytes / t.totalBytes) * 100)) : t.status === "downloading" ? 0 : 0;
                  const Brand = BRAND_ICONS[t.platform];
                  return (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-background p-2.5">
                      <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                        {t.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : null}
                        {Brand ? <span className="absolute bottom-1 left-1 text-white/90"><Brand className="h-3 w-3" /></span> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{t.qualityLabel} · {t.platformName}</p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t.status === "failed" ? <span className="text-rose-500">Failed — {t.error}</span> : t.status === "paused" ? "Paused" : t.status === "queued" ? "Queued…" : t.status === "preparing" ? "Preparing file…" : (
                            <>
                              {formatBytes(t.receivedBytes)}{t.totalBytes ? ` / ${formatBytes(t.totalBytes)}` : ""}
                              {t.speed ? ` · ${formatBytes(t.speed)}/s` : ""}{t.totalBytes ? ` · ${pct}%` : ""}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {t.status === "failed" ? (
                          <IconBtn label="Retry" onClick={() => retryDownload(t.id)}><RotateCw className="h-4 w-4" /></IconBtn>
                        ) : t.status === "paused" ? (
                          <IconBtn label="Resume" onClick={() => resumeDownload(t.id)}><Play className="h-4 w-4" /></IconBtn>
                        ) : (
                          <IconBtn label="Pause" onClick={() => pauseDownload(t.id)}><Pause className="h-4 w-4" /></IconBtn>
                        )}
                        <IconBtn label="Cancel" onClick={() => cancelDownload(t.id)}><X className="h-4 w-4" /></IconBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Admin-managed ad slot ABOVE the history list; collapses when empty. */}
          <DownloadHistoryAd position="top" maxWidth="max-w-3xl" />

          {/* Downloaded — the SAME iOS-Photos gallery the landing history uses.
              Full Bleed ONLY: its bottom nav has no History tab, so the history
              lives here. Downloader mode has a dedicated History page, so this is
              hidden there to avoid duplicating it (owner). */}
          {showHistory ? (
            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold">Downloaded ({filtered.length})</h2>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    aria-label="Search downloads"
                    className="h-9 w-32 rounded-lg bg-secondary/60 pl-8 pr-2 text-sm text-foreground outline-none ring-1 ring-inset ring-transparent transition focus:w-44 focus:bg-background focus:ring-primary sm:w-40"
                  />
                </div>
              </div>
              <MediaGallery
                items={filtered}
                onToggleFavorite={toggleFavorite}
                onRemove={removeDownload}
                emptyText="No downloads yet — paste a link above to download your first video."
              />
            </section>
          ) : null}

          {/* Wallpapers — the real library; every tile opens the reels viewer. */}
          {/* /downloads is behind a sign-in redirect, so the viewer is always a
              member here — engagement is enabled. */}
          <WallpaperGallery items={wallpapers} canEngage />

          {/* Admin-managed ad slot below the history list — insert or remove any
              ad for this zone from the dashboard; collapses when empty. */}
          <DownloadHistoryAd position="bottom" maxWidth="max-w-3xl" />

          {/* "Tired of ads → Upgrade to Pro" — shown only to visitors who see
              ads (free / signed-out); Pro and Business never see it. */}
          <TiredOfAds />

          {/* The reference's closing strip. Guarantees, not invented totals —
              see the note in downloads-sections. */}
          <DownloadTrustStrip />
        </div>

        {/* Storage, Quick Actions, Categories and Learn. A sticky sidebar at
            `xl`, a stacked column everywhere else — see DownloadsRail. */}
        <DownloadsRail />
      </div>

      {/* The download-flow interstitial (5s idle · every 3rd download · every 3rd
          history watch) and the exit-intent unit — the marketing furniture the
          app shell doesn't carry, brought to the download page. Both render
          nothing for premium visitors (except the watch-trigger, which a Pro user
          still sees). */}
      <DownloadInterstitial />
      <ExitIntent />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-foreground transition hover:bg-secondary/70">
      {children}
    </button>
  );
}

