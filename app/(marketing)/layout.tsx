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
      {/* Reserve room for the fixed TOP bars: the GLOBAL announcement bar
          (--frenz-announce-h) plus the content-page top ad stacked below it
          (--frenz-topbanner-h). Each is 0 when absent, so an unbannered page keeps
          its exact layout; this padding pushes the page's content clear of both. */}
      {/*
        No `transition-[padding]` here (owner, 2026-08-09: "the landing page
        shouldn't carry any animation while opening").

        Both custom properties start at 0 and are published by the bars AFTER
        they mount, so the transition had exactly one job on a cold load:
        animating the whole page downwards for 200ms while a visitor was trying
        to read it. It did not soften the layout shift either — CLS scores the
        movement whether it is eased or instant — it only made the page take a
        fifth of a second longer to stop moving.
      */}
      <div style={{ paddingTop: "calc(var(--frenz-announce-h, 0px) + var(--frenz-topbanner-h, 0px))" }}>
        {children}
      </div>
      {/* Reserve room for the fixed BOTTOM ad bar (it now sits above the bottom nav
          — see top-banner-ad.tsx), so a page's last content clears it instead of
          hiding under it. The bar publishes its height as --frenz-bottomad-h (0 when
          there's no ad, so an ad-free page keeps its exact layout). The fixed
          header/nav/ad ignore this spacer — only the in-flow content shifts. */}
      {/* Same reasoning as the top spacer — reserved instantly, never eased. */}
      <div aria-hidden style={{ height: "var(--frenz-bottomad-h, 0px)" }} />
      {/* App-style edge-to-edge bottom nav on every marketing page (mobile only),
          and a spacer so a page's last content clears the fixed bar. */}
      <div aria-hidden className="h-20 lg:hidden" />
      <MobileAppNav />
      {/* Buffer the first reels ahead of a tap (after idle, good connections only). */}
      <ReelsWarmup urls={reelUrls} />
      <DeferredAdFurniture />
    </>
  );
}
