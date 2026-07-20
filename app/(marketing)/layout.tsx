import { DeferredAdFurniture } from "@/features/monetization/deferred-ad-furniture";

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
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <DeferredAdFurniture />
    </>
  );
}
