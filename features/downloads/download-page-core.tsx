"use client";

import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";

import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import { WallpaperCta } from "@/components/wallpapers/wallpaper-cta";
import { HilltopSlot } from "@/features/monetization/hilltop-slot";
import { LazyAdSurface } from "@/features/monetization/lazy-ad-surface";
import { LazyExoClickSlot } from "@/features/monetization/lazy-exoclick-slot";
import { DownloadBox } from "@/features/downloads/download-box";
import type { MultiLinkPublicConfig } from "@/lib/downloads/multi-link-config";
import {
  CloudStorageCard,
  DownloadsHero,
  DownloadStats,
  RecentDownloads,
} from "@/features/downloads/downloads-sections";
import { useHistory } from "@/features/history/use-history";
import { AdSurface } from "@/features/monetization/ad-surface";
import { InstallHeroBanner } from "@/features/pwa/install-button";
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
  /** Rotates the Wallpaper tile through up to 10 recent uploads every 2s
   *  (see wallpaper-cta-rotator.tsx). Both callers pass this now — landing's
   *  `Hero` fetches its own `listWallpapers(null, 10)`; `/downloads` reuses
   *  the first 10 of the gallery's own already-fetched list (2026-08-17 fix:
   *  it used to render this same tile with nothing here, so it fell back to
   *  a single static image and never rotated — the owner's "wallpaper
   *  button isnt changing wallpaper... like the landing page" report). */
  rotateUrls,
  showDisclaimer = false,
  /** Admin "Feature visibility" for the Multi-Link batch downloader — read on
   *  the server page (this file and `DownloadBox` are both client components)
   *  and passed straight through, exactly like `platformStatus`. */
  multiLink,
  installBanner = true,
  multiFormatSlot = false,
}: {
  platformStatus?: PlatformStatusMap;
  ctaWallpaperUrl?: string | null;
  rotateUrls?: string[];
  showDisclaimer?: boolean;
  multiLink?: MultiLinkPublicConfig;
  /**
   * Whether to render the Install banner under the paste box.
   *
   * Off on the LANDING (owner, 2026-08-25: the hero's install CTA "is causing
   * visual noise") — that page carries `InstallHeaderCta` in its top bar
   * instead, having given up its wordmark text and search trigger to fit it.
   * On by default so `/downloads`, whose header has no room for the group,
   * keeps the banner it has always had.
   */
  installBanner?: boolean;
  /**
   * Whether to render the ExoClick multi-format slot above the Cloud storage
   * card. LANDING ONLY.
   *
   * Off by default because this component is shared with `/downloads`, and an
   * ExoClick `<ins>` that appears on a second page is a second placement — one
   * zone id cannot serve two of them, so a slot that quietly follows the
   * component onto another route is how the duplicate-zone bug comes back.
   */
  multiFormatSlot?: boolean;
}) {
  const { items } = useHistory();

  return (
    <>
      <DownloadsHero />

      {/*
        🔴 Install moved BELOW the paste box (owner, 2026-08-25, with a
        reference screenshot): the download field is what the page exists for,
        so it now comes first and the install prompt sits under it, above the
        Multi-Link block. It is passed into DownloadBox's `afterForm` slot so
        the three land in the reference's order inside one card. The banner
        itself is unchanged — it still renders in the first paint and removes
        itself via CSS once installed, so it never shifts the headline.
      */}
      <section id="download" className="mt-5 scroll-mt-20">
        <div className="rounded-[1.5rem] bg-white p-4 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] ring-1 ring-inset ring-slate-900/[0.06] dark:bg-[#0b1020] dark:ring-white/10 sm:p-5">
          <DownloadBox
            surface="card"
            platformStatus={platformStatus}
            multiLink={multiLink}
            afterForm={installBanner ? <InstallHeroBanner /> : null}
          />
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

      {/*
        🔴 THE MULTI-FORMAT SLOT, WHERE IT WAS ACTUALLY ASKED FOR (owner,
        2026-09-01: "put a multi format slot in the landing page ABOVE THE
        STORAGE CARD and below the explore feature and wallpaper button").

        It shipped in app/(marketing)/page.tsx instead, after `ProductGrid`,
        on the reading that the grid "ends with the feature cards and then the
        Explore-wallpapers CTA". Those are different cards with similar names.
        Measured on the live page: that put the unit at **y=7698 of an 11,315px
        document**, and the events table proves the consequence — every other
        ExoClick slot reported fills and no-fills for two and a half hours while
        `landing` reported NOTHING AT ALL, because no reader ever scrolled to
        it. The cards the owner named are these two, at y≈700.

        ⚠️ This DOES sit above Cloud storage, which reverses the 2026-08-30 rule
        below ("the sections starts from below the cloud storage section") for
        this one unit. The 09-01 instruction names the position explicitly and is
        newer, so it wins; the `under_download` zone below keeps the old rule.

        Lazy and code-split exactly as before — the unit is not in the landing's
        first-load bundle and does not mount until it is near the viewport.
      */}
      {multiFormatSlot ? (
        <div className="mt-3">
          {/*
            🔴 ANY NETWORK HERE TOO (owner, 2026-09-01: "... and below the
            wallpaper button to be able to use adsense and adsterra banner
            iframe and social link and native ad").

            `landing_under_wallpaper` is an ordinary AD ZONE — a row in the ads
            table — so this position takes AdSense, an Adsterra banner iframe, a
            social-link or a native unit without needing an ExoClick snippet.
            `LazyAdSurface`, not `AdSurface`: this is the 1.6s route, and the
            zone must not be requested until the reader is near it. Both units
            collapse to nothing when unconfigured, which is their default.
          */}
          <LazyAdSurface zone="landing_under_wallpaper" />
          <HilltopSlot slot="landing" lazy />
          <LazyExoClickSlot slot="landing" />
        </div>
      ) : null}

      <div className="mt-3">
        <CloudStorageCard items={items} />
      </div>

      {/*
        🔴 MOVED BELOW CLOUD STORAGE, and given room (owner, 2026-08-30: "the
        sections starts from below the cloud storage section" … "give a small
        padding space between the first slot and the hero section").

        It used to sit between the Explore/Wallpaper cards and this card, which
        measured live at y=823 — inside the hero block, wedged against the Cloud
        storage card with no separation. `mt-6` is double the `mt-3` rhythm the
        rest of this stack uses, so the first ad reads as the start of a new
        band rather than another card in the hero.

        `fullBleed` for the same reason every other video zone has it: the card
        border was the white frame around the unit.
      */}
      <AdSurface zone="under_download" fullBleed className="mt-6" />

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
