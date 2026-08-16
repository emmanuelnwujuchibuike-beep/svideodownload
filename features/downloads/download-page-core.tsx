"use client";

import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";

import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { WallpaperCta } from "@/components/wallpapers/wallpaper-cta";
import { DownloadBox } from "@/features/downloads/download-box";
import {
  CloudStorageCard,
  DownloadsHero,
  DownloadStats,
  RecentDownloads,
} from "@/features/downloads/downloads-sections";
import { useHistory } from "@/features/history/use-history";
import { AdSurface } from "@/features/monetization/ad-surface";
import type { PlatformStatusMap } from "@/lib/platform-status";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SHARED TOP OF /downloads — now also the landing page's hero
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-16, after several rounds of hand-building a landing hero
 * that merely LOOKED like the Download page: "make the download page to the
 * reusable, i want the landing page to be like the download page exactly…
 * let the from the recent download all the way up to the download, discover
 * explore text, all section must be shared, remove the old landing section,
 * from the iphone mockup above."
 *
 * This is that extraction. `downloads-page.tsx`'s own render — hero → paste
 * card → Explore/Wallpaper tiles → ad slot → cloud storage → stat tiles →
 * recent downloads — moves here VERBATIM (same components, same order, same
 * classes) and both `/downloads` and the landing page render THIS, not two
 * copies that have to be kept in sync by hand. Everything below "Recent
 * downloads" on /downloads — quick actions, the usage dashboard, the
 * downloading/history/wallpaper-gallery grid, the trust strip — stays where
 * it is, in `downloads-page.tsx`, because the owner named "recent download"
 * as the explicit lower boundary of what's shared.
 *
 * ── Why this works for a signed-OUT landing visitor ─────────────────────────
 * Every piece here already supports the guest state — `useHistory()`,
 * `useEntitlements()` (inside `DownloadBox`/`CloudStorageCard`) all degrade to
 * anonymous/guest defaults elsewhere in this app (the whole guest-library
 * system). `RecentDownloads` and the "Downloading" list on /downloads already
 * self-hide on empty history (`if (recent.length === 0) return null`), so a
 * visitor with nothing downloaded yet simply doesn't see that section — never
 * an empty-state placeholder, never fabricated content. The `/downloads`
 * ROUTE's own sign-in redirect is a page-level product decision (that URL is
 * the full personal dashboard), not a requirement of these components.
 *
 * `disclaimer`: /downloads renders `DownloadDisclaimer` far below this block
 * (after the whole Hub grid). The landing page has no other place for it once
 * its own hand-built CTA stack — the thing that used to carry it — is gone,
 * so this component renders it too, immediately after Recent downloads,
 * keyed by `showDisclaimer` so `/downloads` doesn't end up with two copies.
 */
export function DownloadPageCore({
  platformStatus,
  ctaWallpaperUrl = null,
  /** Landing-only: rotates the Wallpaper tile through the last 10 uploads
   *  every 2s (see wallpaper-cta-rotator.tsx). /downloads never passes this —
   *  same component, one caller supplying data the other doesn't have wired. */
  rotateUrls,
  showDisclaimer = false,
}: {
  platformStatus?: PlatformStatusMap;
  ctaWallpaperUrl?: string | null;
  rotateUrls?: string[];
  showDisclaimer?: boolean;
}) {
  const { items } = useHistory();

  return (
    <>
      <DownloadsHero />

      <section id="download" className="mt-5 scroll-mt-20">
        <div className="rounded-[1.5rem] bg-white p-4 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06] dark:bg-[#0b1020] dark:ring-white/10 sm:p-5">
          <DownloadBox surface="card" platformStatus={platformStatus} />
        </div>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link
          href="/features"
          className="group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl bg-white p-4 text-left text-slate-900 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06] transition duration-200 hover:-translate-y-0.5 active:scale-[0.995] dark:bg-white/[0.04] dark:text-white dark:ring-white/10"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-8 top-6 h-32 w-32 rotate-[18deg] rounded-[2rem] bg-gradient-to-br from-violet-400/25 via-indigo-400/15 to-transparent blur-[1px] transition-transform duration-500 group-hover:rotate-[22deg] motion-reduce:transition-none dark:from-violet-400/20 dark:via-indigo-400/10"
          />
          <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Compass className="h-6 w-6" />
          </span>
          <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight">Explore Features</span>
              <span className="mt-1 block text-xs leading-snug text-slate-500 dark:text-white/60">
                See everything Frenz can do.
              </span>
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 transition group-hover:bg-slate-200 dark:bg-white/10 dark:ring-white/15">
              <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5 dark:text-white" />
            </span>
          </span>
        </Link>

        <WallpaperCta variant="card" backgroundUrl={ctaWallpaperUrl} rotateUrls={rotateUrls} />
      </div>

      <AdSurface zone="under_download" maxWidth="max-w-3xl" />

      <div className="mt-3">
        <CloudStorageCard items={items} />
      </div>

      <div className="mt-3">
        <DownloadStats items={items} />
      </div>

      <div className="mt-3">
        <RecentDownloads items={items} />
      </div>

      {showDisclaimer ? (
        <div className="mt-3">
          <DownloadDisclaimer variant="card" />
        </div>
      ) : null}
    </>
  );
}
