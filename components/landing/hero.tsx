import { DownloadPageCore } from "@/features/downloads/download-page-core";
import { getMultiLinkSettings, publicMultiLinkConfig } from "@/lib/downloads/multi-link";
import { getLandingSettings } from "@/lib/landing/settings";
import { getPlatformStatus } from "@/lib/platform-status-store";
import { listWallpapers } from "@/lib/wallpapers-server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LANDING HERO — now literally the Download page's own top section
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-16, after several rounds of a hand-built lookalike hero:
 * "make the download page to the reusable, i want the landing page to be
 * like the download page exactly, only below the recent download section in
 * download page should not be in the landing page, let the from the recent
 * download all the way up to the download, discover explore text, all
 * section must be shared, remove the old landing section, from the iphone
 * mockup above."
 *
 * Everything that used to live here — the eyebrow badge, the "Download.
 * Discover/Connect. Explore." H1 built a second time, the phone mockup, the
 * bitmoji avatar stack, the CTA-stack paste form, the "No Watermark / Full
 * HD / 100% Free / Fast" strip, the four-tile trust row — is GONE. All of it
 * was a separate implementation that had to be kept looking like Download's
 * by hand, which is exactly how it kept drifting. `DownloadPageCore` is the
 * real thing: the same `DownloadsHero`, the same paste card
 * (`DownloadBox surface="card"`), the same Explore/Wallpaper tiles, the same
 * Cloud storage card, the same stat tiles, the same Recent downloads list
 * `features/downloads/downloads-page.tsx` renders on `/downloads` — one
 * component, two call sites, so a change to either page's shared section
 * can no longer happen to only one of them.
 *
 * `showDisclaimer` is on here specifically: `/downloads` renders its own
 * `DownloadDisclaimer` further down, below the sections this component
 * shares, so passing it there would print the sentence twice. Landing has no
 * other place for it now that the hand-built CTA stack that used to carry it
 * is gone, so this is the one call site that turns it on.
 */
export async function Hero() {
  /*
    The last 10 published wallpapers, newest first — for the CTA tile's
    rotation (owner, 2026-08-16: "wallpapers that will be changed will be the
    last 10 wallpapers uploaded in wallpaper pages"). `/downloads` now passes
    its own `rotateUrls` too (2026-08-17 fix, features/downloads/
    downloads-page.tsx — it used to pass nothing, so its tile never rotated),
    reusing its already-fetched gallery list instead of a second query like
    this one. Best-effort here: an empty library or a read failure just means
    the tile falls back to the admin's own static pick, exactly like before
    this existed.
  */
  const [landing, platformStatus, recentWallpaperUrls, multiLink] = await Promise.all([
    getLandingSettings(),
    getPlatformStatus(),
    listWallpapers(null, 10)
      .then((ws) => ws.map((w) => w.url).filter(Boolean))
      .catch(() => [] as string[]),
    // Joins the existing parallel fetch rather than adding a serial await —
    // it is a cached settings read, so it adds no measurable time to the hero.
    getMultiLinkSettings(),
  ]);

  return (
    <section className="container px-3 pb-5 pt-[calc(var(--frenz-safe-top)+4.5rem)] text-foreground dark:text-white sm:pb-7 sm:pt-[calc(var(--frenz-safe-top)+5.5rem)]">
      <DownloadPageCore
        platformStatus={platformStatus}
        ctaWallpaperUrl={landing.wallpaperCtaImageUrl || null}
        rotateUrls={recentWallpaperUrls}
        showDisclaimer
        multiLink={publicMultiLinkConfig(multiLink)}
      />
    </section>
  );
}
