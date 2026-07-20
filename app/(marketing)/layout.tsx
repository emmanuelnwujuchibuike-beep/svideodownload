import { AdScripts } from "@/features/monetization/ad-scripts";
import { ExitIntent } from "@/features/monetization/exit-intent";
import { IdleInterstitial } from "@/features/monetization/idle-interstitial";
import { StickyBottomAd } from "@/features/monetization/sticky-bottom-ad";

/**
 * The marketing shell — site-wide ad furniture, in one place.
 *
 * ── Why a layout and not 150 page edits ───────────────────────────────────────
 *
 * The brief was that EVERY page in this group carries a fixed bottom banner,
 * including the ones with no paste box. That is ~150 routes once the generated
 * downloader pages are counted, and adding three components to each of them by
 * hand guarantees the set drifts: a page added next month gets a header, a
 * footer and no banner, and nobody notices because the missing thing is an
 * absence.
 *
 * Putting them in the layout makes coverage structural. A new route under
 * `(marketing)` is covered the moment it exists.
 *
 * ── This does NOT un-static anything ──────────────────────────────────────────
 *
 * All three are client components that fetch after paint. A layout only breaks
 * static generation when it reads request-time data — `cookies()`, `headers()`,
 * `searchParams` — and none of these do. The build output is the check that
 * matters here, and it still reports every page in this group as prerendered.
 *
 * ── Order ─────────────────────────────────────────────────────────────────────
 *
 * `children` first so page content is in the document before the furniture, and
 * the two overlays last so they sit above it without needing a portal.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/*
        Each of these renders nothing at all until its zone has an ad, and
        nothing ever for a premium visitor. An unconfigured site gets exactly
        the same markup it had before this layout existed.
      */}
      <StickyBottomAd />
      <IdleInterstitial />
      <ExitIntent />
      <AdScripts />
    </>
  );
}
