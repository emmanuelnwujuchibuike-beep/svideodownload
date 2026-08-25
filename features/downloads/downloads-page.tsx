"use client";

import { Pause, Play, RotateCw, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { useAppMode } from "@/features/app-shell/use-app-mode";
import type { PlatformStatusMap } from "@/lib/platform-status";

import { DownloadPageCore } from "@/features/downloads/download-page-core";
import { DownloadQuickActions, DownloadTrustStrip } from "@/features/downloads/downloads-sections";
import { HubWarmup } from "@/features/downloads/hub-warmup";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { MediaGallery } from "@/features/history/media-gallery";

/*
  ── /downloads held to the landing's discipline (owner, 2026-08-10) ──────────
  "Make the download page use the same budget and performance and LCP as the
  landing page, in case of users who have an account."

  This page had ZERO dynamic imports — every panel on it, including several
  screens below the fold, was in the first load. The three split here are the
  ones a signed-in visitor cannot see until they scroll, and none of them is on
  the path to the thing the page exists for (the paste box at the top):

   • HistoryPanel      — behind a `showHistory` toggle, so it frequently never
                         renders at all.
   • WallpaperGallery  — a full media grid, several screens down.
   • DownloadsRail     — the sidebar; at `xl` it is beside the content, below it
                         everywhere else, and never above the fold on a phone.

  `ssr: false` on all three: this route is behind a sign-in redirect and is
  already `ƒ` (server-rendered on demand), so there is no prerendered HTML to
  preserve, and each of these reads client state (history store, viewer,
  entitlements) on mount anyway.

  🔴 What is deliberately NOT split: `MotionConfig` in the (app) layout, which
  is where the 39 kB of framer-motion on this route comes from. Deferring it
  would change the element type wrapping the whole app subtree once the chunk
  landed, which REMOUNTS every page below it — and removing it outright would
  drop the app-wide reduced-motion baseline that makes every framer transition
  collapse under `prefers-reduced-motion` with no per-component opt-in. That is
  an accessibility regression, and this project just took accessibility from 87
  to 100. Bytes do not get bought with that. See the ceiling note in
  lib/perf/budget.test.ts for what byte-parity with the landing would actually
  cost.
*/
const HistoryPanel = dynamic(
  () => import("@/features/history/history-panel").then((m) => m.HistoryPanel),
  { ssr: false },
);
const WallpaperGallery = dynamic(
  () => import("@/features/wallpapers/wallpaper-gallery").then((m) => m.WallpaperGallery),
  { ssr: false },
);
const DownloadsRail = dynamic(
  () => import("@/features/downloads/downloads-rail").then((m) => m.DownloadsRail),
  { ssr: false },
);
import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { AdSurface } from "@/features/monetization/ad-surface";
import { DownloadHistoryAd } from "@/features/monetization/download-history-ad";
import { DownloadInterstitial } from "@/features/monetization/download-interstitial";
import { ExitIntent } from "@/features/monetization/exit-intent";
import { TiredOfAds } from "@/features/monetization/tired-of-ads";
import { UsageDashboard } from "@/features/downloads/usage-dashboard";
import { ExploreWallpapersCta } from "@/components/wallpapers/explore-wallpapers-cta";

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

export function DownloadsPage({
  wallpapers,
  /** Admin-chosen background for the Wallpaper Gallery tile — see lib/wallpapers-cta. */
  ctaWallpaperUrl = null,
  /** Platform health for the supported-platforms strip inside DownloadBox. */
  platformStatus,
  /** Admin visibility switch for the Multi-Link batch downloader — same
   *  server-resolved-prop reason as the two above. */
  multiLinkEnabled = true,
}: {
  wallpapers: Wallpaper[];
  ctaWallpaperUrl?: string | null;
  platformStatus?: PlatformStatusMap;
  multiLinkEnabled?: boolean;
}) {
  const { items, toggleFavorite, removeDownload } = useHistory();
  const { tasks, pauseDownload, resumeDownload, retryDownload, cancelDownload, pauseAll } = useDownloadManager();

  /*
    🔴 THE MISSING PROP (owner, 2026-08-17: "the wallpaper button isnt
    changing wallpaper in the background like the landing page wallpaper
    button"). `DownloadPageCore`'s CTA tile only rotates through several
    photos when handed `rotateUrls` — the landing page's own `Hero` fetches
    a dedicated `listWallpapers(null, 10)` for it, but this page never
    passed anything, so `/downloads`'s tile fell back to a single static
    image and never rotated. `wallpapers` is already fetched (for the
    gallery grid below) from the SAME published set the landing page's
    query hits — reusing its first 10 here is the fix, with no extra
    network round-trip.
  */
  const rotateUrls = useMemo(() => wallpapers.slice(0, 10).map((w) => w.url).filter(Boolean), [wallpapers]);

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

      {/*
        ── The shared top of the page, now literally shared (owner, 2026-08-16:
        "make the download page to the reusable… let the from the recent
        download all the way up to the download, discover explore text, all
        section must be shared") ──────────────────────────────────────────
        Hero, paste card, Explore/Wallpaper tiles, the under-download ad slot,
        cloud storage, stat tiles and Recent downloads all live in
        `DownloadPageCore` now — the landing page renders the exact same
        component. Everything below this line is /downloads-only, per the
        owner's own stated boundary ("recent download" is the last shared
        section) — quick actions, the usage dashboard, the downloading list,
        history panel, wallpaper gallery and trust strip stay here.
      */}
      <DownloadPageCore platformStatus={platformStatus} ctaWallpaperUrl={ctaWallpaperUrl} rotateUrls={rotateUrls} multiLinkEnabled={multiLinkEnabled} />

      <DownloadQuickActions />

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
          {/*
            🔴 The SAME panel /history renders (owner, 2026-08-09: "the download
            history doesn't look like the image I saved in public").

            It didn't, and this is why. `public/mainhistorypage.jpg` was built
            into `HistoryPanel`, which only `/history` and the guest library
            used. This page had its own hand-rolled header — a small
            "Downloaded (n)" heading and a shrink-to-fit search box — wrapped
            around the bare gallery, so a signed-in member looking at their
            downloads here saw none of the redesign.

            Two headers over one gallery was always going to drift; there is now
            one. Everything this section had is still here, because HistoryPanel
            has all of it and more: search (full width now), the type filters,
            Select mode, day sections and the column picker.
          */}
          {showHistory ? (
            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
              <HistoryPanel embedded />
            </section>
          ) : null}

          {/* Same "Explore wallpapers" pill as the landing page (owner,
              2026-08-16: "let the download page share same wallpaper button
              with the landing page") — a promotional entry point into the
              full-screen gallery, right above the embedded grid it opens. */}
          <ExploreWallpapersCta className="flex justify-center" />

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

      {/*
        🔴 The trademark disclaimer, in its card treatment (owner, 2026-08-11 —
        it is in the reference screenshot of this page).

        The same component and the same sentence the landing renders, so there is
        still exactly one copy of this text in the codebase. It closes the page,
        which is where a footnote belongs and where the reference puts it.

        Checked before adding: nothing else in this tree rendered one. `/downloads`
        shows the platform logos in `DownloadBox` and had no disclaimer under
        them at all — so this is a gap being closed, not a second copy.
      */}
      <DownloadDisclaimer variant="card" />
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

