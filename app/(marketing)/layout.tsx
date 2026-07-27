import { MobileAppNav } from "@/components/landing/mobile-app-nav";
import { ReelsWarmup } from "@/components/landing/reels-warmup";
import { DeferredAdFurniture } from "@/features/monetization/deferred-ad-furniture";
import { getFeed } from "@/lib/social/feed";

/**
 * The first couple of reel VIDEO urls, so `ReelsWarmup` can buffer them ahead of a
 * tap on the Reels nav / the hero mockup (owner). Own-hosted media only — the same
 * rule the hero uses, since source-CDN urls expire and 403. A DB read (no cookies)
 * at build/ISR, so it never un-statics a marketing page.
 */
async function firstReelUrls(): Promise<string[]> {
  const ownMedia = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!ownMedia) return [];
  try {
    const posts = await getFeed({ sort: "trending", viewerId: null, limit: 8, diversityCap: 999 });
    return posts
      .filter((p) => p.mediaKind === "video" && !!p.mediaUrl && p.mediaUrl.startsWith(ownMedia))
      .slice(0, 2)
      .map((p) => p.mediaUrl!);
  } catch {
    return [];
  }
}

/**
 * The marketing shell — site-wide ad furniture, in one place.
 *
 * ── Why a layout and not 150 page edits ───────────────────────────────────────
 *
 * The brief was that EVERY page in this group carries the site-wide ad units —
 * the bottom banner especially — including the ones with no paste box. That is
 * ~150 routes once the generated downloader pages are counted, and adding
 * components to each by hand guarantees the set drifts: a page added next month
 * gets a header, a footer and no banner, and the missing thing is an absence
 * nobody notices. Putting them in the layout makes coverage structural.
 *
 * ── Deferred, so the landing page still opens fast ────────────────────────────
 *
 * `DeferredAdFurniture` code-splits all four units out of the initial bundle and
 * mounts them only after the browser is idle post-hydration. The landing page's
 * two-second budget and its hydration-gated LCP cannot afford four more client
 * components in the first hydration task, and none of these needs to be there:
 * the banner is below the fold, the interstitial waits three seconds, the exit
 * unit fires on the way out. See that component for the full reasoning.
 *
 * ── This does NOT un-static anything ──────────────────────────────────────────
 *
 * Everything here is client-only and fetches after paint. A layout only breaks
 * static generation when it reads request-time data, and this reads none — the
 * build still reports every page in this group as prerendered.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const reelUrls = await firstReelUrls();
  return (
    <>
      {/* Reserve room for the fixed top ad bar (below the header) when one is
          filling, so the page content clears it instead of hiding under it. The bar
          publishes its height as --frenz-topad-h (0 when there's no ad, so an
          ad-free page keeps its exact layout). The fixed header/nav/ad ignore this
          padding — only the in-flow content shifts. */}
      <div style={{ paddingTop: "var(--frenz-topad-h, 0px)" }} className="transition-[padding] duration-200">
        {children}
      </div>
      {/* App-style liquid-glass bottom nav on every marketing page (mobile only),
          and a spacer so a page's last content clears the floating pill. */}
      <div aria-hidden className="h-24 lg:hidden" />
      <MobileAppNav />
      {/* Buffer the first reels ahead of a tap (after idle, good connections only). */}
      <ReelsWarmup urls={reelUrls} />
      <DeferredAdFurniture />
    </>
  );
}
