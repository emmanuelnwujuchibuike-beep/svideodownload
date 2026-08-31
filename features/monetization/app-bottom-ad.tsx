"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The docked bottom banner for the SIGNED-IN app surfaces.
 *
 * ── What this replaced ───────────────────────────────────────────────────────
 *
 * `downloads-bottom-ad.tsx`, which mounted the same bar on `/downloads` and
 * nowhere else. Owner, 2026-08-31: "the bottom banner doesnt show on other
 * pages, the bottom nav doesnt hide for the bottom banner on navigation on
 * other pages, only on landing and download page."
 *
 * `TopBannerAd` is mounted by `DeferredAdFurniture`, which lives in
 * `app/(marketing)/layout.tsx` — so the landing page, the ~148 SEO downloader
 * pages and `/history` all had it, and every `(app)` route except `/downloads`
 * had nothing. Moving the mount into the `(app)` LAYOUT is what makes a page
 * added tomorrow inherit the bar instead of being the next one to be reported
 * as missing it.
 *
 * ── 🔴 The exclusions, and what each one would break ─────────────────────────
 *
 * These are surfaces that already own the bottom of the screen. Docking a
 * second bar there does not read as an ad placement, it reads as a bug:
 *
 *  • `/reels` — a full-screen vertical stage. It has its own ad slide in the
 *    deck (`reels_interstitial`); a bar across the bottom would cover the
 *    caption and the action rail on every reel.
 *  • `/messages` — the composer is docked at the bottom. An ad bar would sit on
 *    top of the text input, which is the one control the page exists for.
 *  • `/create` — the studio's own action bar (post / next / publish) is docked
 *    there for the same reason.
 *
 * Everything else — home, feed, friends, saved, search, explore, notifications
 * and the whole of `/account` (which is "settings" and "profile" in the owner's
 * words) — gets the bar, and therefore gets the nav choreography, because the
 * nav now follows the BAR rather than a route name (see `lib/dom/bottom-ad-bar.ts`).
 *
 * Matching on pathname rather than a per-page flag, for the same reason
 * `PageRefresh` does: an opt-out a page has to remember to set is an opt-out the
 * next page forgets.
 *
 * ── Deferred, like the marketing furniture it mirrors ────────────────────────
 *
 * Code-split and mounted two frames after first paint: the bar is below the
 * fold, nothing about first paint depends on it, and these routes already carry
 * the signed-in shell's weight.
 */
const TopBannerAd = dynamic(() => import("./top-banner-ad").then((m) => m.TopBannerAd), {
  ssr: false,
});

/** Surfaces that already own the bottom edge — see the note above. */
const EXCLUDED_PREFIXES = ["/reels", "/messages", "/create"];

function isExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppBottomAd() {
  const pathname = usePathname() ?? "";
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

  if (!ready || isExcluded(pathname)) return null;
  return <TopBannerAd />;
}
