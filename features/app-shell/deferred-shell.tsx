"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/**
 * The app-wide islands that do NOT need to exist during the first hydration
 * task — mounted one paint later.
 *
 * ── Why this is the LCP lever (owner, 2026-08-10: "I want performance green") ─
 * This project measured, back in July, that the landing's LCP lands at the END
 * OF THE FIRST HYDRATION TASK rather than when the hero's bytes arrive. The
 * current numbers say the same thing: FCP 1.4s against LCP 4.3s and TTI 9.9s,
 * with CLS at 0.001 and TBT at 60ms — nothing is shifting and nothing is
 * blocking, the largest element simply cannot finish painting until React has
 * worked through the tree.
 *
 * Five components were hydrating in that task on EVERY page, and not one of
 * them is needed for the first paint or the first tap:
 *
 *   • CommandCenterMount  — a keydown listener for ⌘K
 *   • RegisterServiceWorker — should run after load by definition
 *   • GlobalErrorCapture  — a window error handler
 *   • WebVitals           — reports metrics that are still being collected
 *   • AnalyticsTracker    — already debounces its own flush
 *
 * They are the same shape of cost `DeferredAdFurniture` was created to solve,
 * so they use the same proven pattern rather than a new one: code-split out of
 * the initial bundle, mounted on the frame AFTER first paint.
 *
 * ── Nothing here is lost by waiting ──────────────────────────────────────────
 * This is the part that makes deferral safe rather than merely faster:
 *
 *   • `web-vitals` reads from PerformanceObserver with `buffered: true`, so
 *     entries that occurred BEFORE it attached are still delivered. LCP and CLS
 *     are reported in full.
 *   • The service worker is registered after load in every recommendation
 *     Google publishes; registering it during hydration competes with the page
 *     it is meant to accelerate.
 *   • ⌘K cannot be pressed before the page has painted.
 *   • The analytics tracker reads `usePathname` and debounces; a two-frame
 *     delay is inside its existing debounce window.
 *
 * The one genuine trade-off is `GlobalErrorCapture`: an exception thrown in the
 * first two frames is no longer captured. That is a narrow window, and the
 * alternative is charging every visitor a slower first paint to catch it.
 *
 * ── 🔴 What this must NOT become ─────────────────────────────────────────────
 * There is a standing rule in this codebase against global runtime that touches
 * NAVIGATION — root-layout client components that patch `pushState` or observe
 * `<html>` have silently broken App Router prefetch here before. Deferring WHEN
 * an existing island mounts does not touch navigation. Adding anything to this
 * file that does would.
 */

const CommandCenterMount = dynamic(
  () => import("@/features/navigation/command-center-mount").then((m) => m.CommandCenterMount),
  { ssr: false },
);
const RegisterServiceWorker = dynamic(
  () => import("@/features/notifications/register-sw").then((m) => m.RegisterServiceWorker),
  { ssr: false },
);
const GlobalErrorCapture = dynamic(
  () => import("@/features/app-shell/global-error-capture").then((m) => m.GlobalErrorCapture),
  { ssr: false },
);
const WebVitals = dynamic(() => import("@/features/perf/web-vitals").then((m) => m.WebVitals), {
  ssr: false,
});
const AnalyticsTracker = dynamic(
  () => import("@/features/analytics/analytics-tracker").then((m) => m.AnalyticsTracker),
  { ssr: false },
);

export function DeferredShell() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    /*
      Two rAFs: the first fires before paint, the second after it. That keeps
      this work off the critical paint while still mounting within a frame or
      two — `requestIdleCallback` was tried for the ad furniture and pushed the
      first ad request past five seconds on a busy page, which is the opposite
      of the goal here.
    */
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  if (!mounted) return null;

  return (
    <>
      <CommandCenterMount />
      <RegisterServiceWorker />
      <GlobalErrorCapture />
      <WebVitals />
      <AnalyticsTracker />
    </>
  );
}
