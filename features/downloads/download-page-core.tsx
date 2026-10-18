"use client";

import { DownloadDisclaimer } from "@/components/legal/download-disclaimer";
import type { AiPromo } from "@/lib/ai/promo/config";
import { HilltopSlot } from "@/features/monetization/hilltop-slot";
import { LazyAdSurface } from "@/features/monetization/lazy-ad-surface";
import { LazyExoClickSlot } from "@/features/monetization/lazy-exoclick-slot";
import { DownloadBox } from "@/features/downloads/download-box";
import { HomeHero, HomeTools, LiveDownloads, StorageRow } from "@/features/downloads/home-screen";
import { MultiLinkButton } from "@/features/downloader/multi-link/multi-link-button";
import { Card } from "@/features/frenz-ui/primitives";
import type { MultiLinkPublicConfig } from "@/lib/downloads/multi-link-config";
import { DownloadStats } from "@/features/downloads/downloads-sections";
import { useHistory } from "@/features/history/use-history";
import { AdSurface } from "@/features/monetization/ad-surface";
import { InstallHeroBanner } from "@/features/pwa/install-button";
import type { PlatformStatusMap } from "@/lib/platform-status";
import { RotatingAdStack } from "@/features/monetization/rotating-ad-stack";

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
 *
 * ── 2026-10-18: one layout, the redesign (design/Main.dc.html) ─────────────
 * /downloads renders its own Home screen now (downloads-page.tsx), so the landing is the only
 * caller, and it draws the same sections from features/downloads/home-screen.tsx. The old layout
 * (DownloadsHero, the Frenz AI / Wallpaper tiles, the credits strip, More to Explore, the Cloud
 * storage card) is gone from this file: nothing rendered it, and it was ~3 kB on the landing's
 * first load — the route the 2-second budget exists for. Every landing-only piece stays: the
 * install-banner choice, the rotating multi-format slot, the under-download zone, the stat tiles
 * once there are downloads, and the disclaimer. No Recent section (owner, 2026-10-18).
 */
export function DownloadPageCore({
  platformStatus,
  /** The last 10 wallpapers — the Wallpapers showcase card rotates through them (owner, 2026-08-16). */
  rotateUrls,
  showDisclaimer = false,
  /** Admin "Feature visibility" for the Multi-Link batch downloader — read on
   *  the server page (this file and `DownloadBox` are both client components)
   *  and passed straight through, exactly like `platformStatus`. */
  multiLink,
  installBanner = true,
  multiFormatSlot = false,
  hideEmptyStats = false,
  /**
   * 🔴 Whether the Tools section (Frenz AI, Wallpapers, Earn, Exclusive, Explore) appears.
   * Default FALSE, deliberately: a caller that forgets to pass this gets no AI door rather than
   * accidentally advertising the feature. The landing passes it (owner, 2026-10-05).
   */
  showFrenzAi = false,
  aiPromo = null,
}: {
  platformStatus?: PlatformStatusMap;
  rotateUrls?: string[];
  showDisclaimer?: boolean;
  multiLink?: MultiLinkPublicConfig;
  /**
   * Whether to render the Install banner under the paste box.
   *
   * Off on the LANDING (owner, 2026-08-25: the hero's install CTA "is causing
   * visual noise") — that page carries `InstallHeaderCta` in its top bar instead.
   */
  installBanner?: boolean;
  showFrenzAi?: boolean;
  /** The landing promotion played over the Frenz AI card (Brief C). Landing only. */
  aiPromo?: AiPromo | null;
  /**
   * Whether to render the multi-format slot. LANDING ONLY: one zone id cannot serve two
   * placements, so a slot that quietly follows the component onto another route is how the
   * duplicate-zone bug comes back.
   */
  multiFormatSlot?: boolean;
  /**
   * Hide the stat tiles while the visitor has no downloads (Landing brief §2, 2026-10-08): four
   * tiles reading "0" and "—" were a screen of nothing.
   */
  hideEmptyStats?: boolean;
}) {
  const { items } = useHistory();

  return (
    <div className="frenz-ui mx-auto max-w-2xl px-1 text-frenz-ink">
      <HomeHero />
      <Card as="section" raised id="download" aria-label="Download a link" className="mt-5 scroll-mt-20 rounded-[26px] p-3.5">
        <DownloadBox surface="frenz" platformStatus={platformStatus} multiLink={multiLink} afterForm={installBanner ? <InstallHeroBanner /> : null} />
      </Card>
      <MultiLinkButton config={multiLink} surface="frenz" className="mt-3" />
      <LiveDownloads />
      {/*
        The multi-format slot (owner, 2026-09-01: right under the hero's buttons, where a reader
        actually sees it — at y=7698 it reported nothing). `landing_under_wallpaper` is an ordinary ad
        zone, so it takes AdSense, an Adsterra iframe, a social link or a native unit; lazy and
        code-split, never requested until the reader is near it.
      */}
      {multiFormatSlot ? (
        <div className="mt-6">
          {/* 2026-10-09 (owner): one slot that rotates between the networks, never stacked */}
          <RotatingAdStack>
            <LazyAdSurface zone="landing_under_wallpaper" />
            <HilltopSlot slot="landing" lazy />
            <LazyExoClickSlot slot="landing" />
          </RotatingAdStack>
        </div>
      ) : null}
      {showFrenzAi ? <HomeTools aiPromo={aiPromo} rotateUrls={rotateUrls ?? []} /> : null}
      <StorageRow items={items} />
      {/* below Cloud storage, given room (owner, 2026-08-30); fullBleed — no white frame round the unit */}
      <AdSurface zone="under_download" fullBleed className="mt-6" />
      {hideEmptyStats && items.length === 0 ? null : (
        <div className="mt-3">
          <DownloadStats items={items} />
        </div>
      )}
      {showDisclaimer ? (
        <div className="mt-3">
          <DownloadDisclaimer variant="card" />
        </div>
      ) : null}
    </div>
  );
}
