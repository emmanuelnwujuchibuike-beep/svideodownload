"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { prefetchZoneIds } from "@/lib/monetization/ad-schema";

import { prefetchZones } from "./ad-cache";

/**
 * The site-wide ad furniture, mounted AFTER the page is interactive.
 *
 * ── Why defer it ──────────────────────────────────────────────────────────────
 *
 * The bottom banner, the idle interstitial, the exit unit and the page-level
 * script loader live on every marketing page — including the landing page,
 * whose whole budget is a two-second cold open and whose LCP is gated on the
 * first hydration task finishing. Hydrating four more client components as part
 * of that task pushes the task longer, so the ad furniture was making the page
 * it sits on open later.
 *
 * None of it is needed at first PAINT. So all four are code-split out of the
 * initial bundle (`dynamic`) and mounted on the frame AFTER the first paint,
 * not during it.
 *
 * ── Data first, components a frame later ──────────────────────────────────────
 *
 * The two moves are separated on purpose. The ad DATA is warmed IMMEDIATELY on
 * mount — one small batched request — so it is in flight during the same tick
 * the page becomes interactive. The heavier furniture COMPONENTS mount one
 * paint later, reading from that warm cache. An earlier version deferred both to
 * `requestIdleCallback` with a two-second timeout, and on a busy page that
 * pushed the first ad request out past five seconds — measured. A double
 * `requestAnimationFrame` keeps the work off the first paint while adding only
 * a frame or two, so ads appear right after hydration instead of seconds later.
 *
 * The visible above-the-fold unit (under the download button) lives in the
 * downloader, not here, and is unaffected either way.
 *
 * ── `ssr: false` is safe here specifically ────────────────────────────────────
 *
 * These render nothing on the server anyway (they gate on client-only state —
 * the visitor's plan, idle timers, ad fills). `next/dynamic` with `ssr: false`
 * has been unreliable elsewhere in this app, but only for components expected to
 * render immediately; here they are deliberately mounted late, so there is
 * nothing racing the import.
 */
const StickyBottomAd = dynamic(
  () => import("./sticky-bottom-ad").then((m) => m.StickyBottomAd),
  { ssr: false },
);
const IdleInterstitial = dynamic(
  () => import("./idle-interstitial").then((m) => m.IdleInterstitial),
  { ssr: false },
);
const ExitIntent = dynamic(() => import("./exit-intent").then((m) => m.ExitIntent), {
  ssr: false,
});
const AdScripts = dynamic(() => import("./ad-scripts").then((m) => m.AdScripts), {
  ssr: false,
});

export function DeferredAdFurniture() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    /*
      Warm the ad data NOW — this is a small same-origin request and the sooner
      it is in flight the sooner the units below can paint. It does not block
      anything; it just fills the cache the components will read from.
    */
    prefetchZones(prefetchZoneIds());

    /*
      Mount the components on the frame after the first paint. Two rAFs: the
      first fires before paint, the second after it, so the furniture is kept
      off the critical paint yet mounts within a frame or two — not the multiple
      seconds a `requestIdleCallback` timeout could cost on a busy page.
    */
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  if (!mounted) return null;

  return (
    <>
      <StickyBottomAd />
      <IdleInterstitial />
      <ExitIntent />
      <AdScripts />
    </>
  );
}
