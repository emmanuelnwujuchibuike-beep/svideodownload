"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * The docked bottom banner, for the SIGNED-IN download hub.
 *
 * ── What was missing ─────────────────────────────────────────────────────────
 *
 * Owner, 2026-08-31: "the bottom banner doesnt show in the signed in download
 * pages."
 *
 * `TopBannerAd` is mounted by `DeferredAdFurniture`, which lives in
 * `app/(marketing)/layout.tsx` and nowhere else. `/downloads` is in the `(app)`
 * group, so that bar had simply never existed on this route — the landing page
 * and the signed-out downloader carried it and the signed-in hub did not.
 *
 * 🔴 It also became a REGRESSION rather than just an absence. The same day, the
 * bottom nav was given a scroll-away behaviour scoped to `/` and `/downloads`,
 * on the premise that the ad bar rises into the space the nav vacates. On this
 * route there was no ad bar to rise, so scrolling down took the navigation away
 * and put nothing in its place. Mounting the bar here is what makes that
 * choreography whole on the second of the two surfaces it was written for.
 *
 * ── Why this page and not the (app) layout ───────────────────────────────────
 *
 * That layout is shared with /home, /reels and the messaging surfaces — all of
 * which own their own vertical gestures and full-bleed chrome. Docking an ad
 * bar across every signed-in surface is a product decision nobody has asked
 * for; this route is the one the report is about.
 *
 * ── Deferred, like the marketing furniture it mirrors ────────────────────────
 *
 * Code-split and mounted two frames after first paint, for the same reason
 * `DeferredAdFurniture` does it: the bar is below the fold, nothing about the
 * page's first paint depends on it, and this route already carries the
 * downloader's own weight.
 */
const TopBannerAd = dynamic(() => import("./top-banner-ad").then((m) => m.TopBannerAd), {
  ssr: false,
});

export function DownloadsBottomAd() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Two frames: one to let this commit paint, one to let the browser settle
    // before anything ad-related starts fetching. Same shape as DeferredShell.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
    };
  }, []);

  if (!ready) return null;
  return <TopBannerAd />;
}
