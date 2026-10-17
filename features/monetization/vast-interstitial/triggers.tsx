"use client";

import { loadAdsConfig } from "@/lib/monetization/ads-config-client";
import { useEffect, useState } from "react";

/**
 * Idle and back-swipe triggers for the ExoClick interstitial.
 *
 * ── Why this exists instead of the Monetag moments ────────────────────────────
 *
 * Owner, 2026-08-30: "it should work without the monetag, i dont want to use
 * monetag for idle or backswipe."
 *
 * The idle/return/back-swipe moments already in the product are Monetag-only:
 * `resolveMonetagPlacements` returns nothing while the Monetag master switch is
 * off, and each moment is a pasted Monetag tag. This drives the SAME two moments
 * from the ExoClick VAST interstitial instead, so they work with Monetag
 * switched off entirely.
 *
 * ── It adds nothing to the critical path ──────────────────────────────────────
 *
 * This component ships two event listeners and a timer — no ad code. The whole
 * interstitial (config fetch, VAST request, player) stays behind the same
 * dynamic `import()` the download trigger uses, so a cold page load is
 * unaffected and a visitor who never goes idle never loads any of it.
 *
 * Everything else is inherited rather than re-implemented: the session guard
 * (one ad at a time), the cooldown, the startup timeout and the fail-open
 * behaviour all live in `request.ts` and apply here unchanged.
 */

/**
 * How long without interaction counts as idle, until the admin value arrives.
 *
 * The admin number replaces this the moment `/api/ads/config` answers — see the
 * effect below. It stays as the pre-config value rather than something shorter
 * so a slow config fetch cannot produce a surprise ad on the first few seconds
 * of a page.
 */
const IDLE_FALLBACK_MS = 45_000;

/**
 * 🔴 MOMENTUM IS ACTIVITY (owner, 2026-10-16: "the history that shows like reward is when I scroll
 * much on history and it starts happening").
 *
 * A fling keeps the page moving for seconds after the finger lifts, and none of that is a touch,
 * wheel or key event — so the 5-second idle countdown ran out MID-SCROLL and the full-screen ad
 * opened over someone still scrolling their History. A scroll now counts, but only inside a
 * gesture the visitor started: within MOMENTUM_MS of a real interaction or of the previous scroll
 * in the same chain. The app's own scroll restoration (no gesture before it) still counts for
 * nothing, which is why bare "scroll" was left out of ACTIVITY on 2026-10-14.
 */
export const MOMENTUM_MS = 1_500;
export function scrollIsGesture(now: number, lastGestureAt: number): boolean {
  return lastGestureAt > 0 && now - lastGestureAt <= MOMENTUM_MS;
}

/** Fire the interstitial, loading it only at that moment. */
function fire() {
  void import("./request")
    // "ambient" — gated by the master switch only, never by the download
    // moment's switch. See `isEnabledFor` in request.ts.
    .then((m) => m.requestVastInterstitial("ambient"))
    .catch(() => {
      /* An ad that cannot load its own module is not the visitor's problem. */
    });
}

export function VastInterstitialTriggers() {
  /*
    The admin-set idle threshold (owner, 2026-09-01: "it triggers very late, it
    should be 5secs or setable in the admin dashboard"). It was hard-coded at 45
    seconds, which on a phone is long enough that the moment looked broken.
  */
  const [idleMs, setIdleMs] = useState(IDLE_FALLBACK_MS);
  useEffect(() => {
    let alive = true;
    loadAdsConfig()
      .then((d: { idleInterstitialSeconds?: number }) => {
        if (alive && typeof d.idleInterstitialSeconds === "number") {
          setIdleMs(d.idleInterstitialSeconds * 1000);
        }
      })
      .catch(() => {
        /* The fallback threshold is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    /*
      IDLE. Re-armed on any real interaction, and never while the tab is
      hidden — a backgrounded tab would otherwise "go idle" instantly and have
      a full-screen ad waiting when the visitor returned, which is the most
      hostile possible version of this placement.
    */
    let timer: number | undefined;
    let warmTimer: number | undefined;
    /*
      ═══════════════════════════════════════════════════════════════════════
       🔴 WARM THE CREATIVE BEFORE THE MOMENT, NOT AT IT
      ═══════════════════════════════════════════════════════════════════════

      Owner, 2026-09-02: "make sure the 5secs interstills fires before 5secs
      finishes."

      Measured on production: the idle interstitial mounts and then takes
      ~9-12s to reach `playing`, because unlike the download moments this one
      was never prefetched — `PREFETCHES_ON_START` only covers download,
      wallpaper and batch, since those have a START event that predicts a
      completion. Idle has no such predecessor, so the creative and its media
      were both fetched cold at the instant the ad was wanted.

      A five-second ad that takes twelve seconds to appear is not a
      five-second ad. So the idle timer is split: at 60% of the threshold the
      creative is fetched and its media warmed, and the remaining 40% is spent
      downloading it. By the time the moment actually arrives the bytes are in
      the HTTP cache and playback starts almost immediately.

      🔴 60%, NOT ON ARM. Warming the instant a page loads would fetch an ad
      for every visitor who never goes idle at all — a VAST request with no
      impression behind it, which is exactly what makes a network's fill rate
      look broken. Waiting until someone is most of the way to idle means we
      only ask for ads we are probably about to show.
    */
    const WARM_AT = 0.6;
    // the last real gesture and the last re-arm (see MOMENTUM_MS)
    let gestureAt = 0;
    let armedAt = 0;
    const arm = () => {
      gestureAt = armedAt = Date.now();
      window.clearTimeout(timer);
      window.clearTimeout(warmTimer);
      if (document.visibilityState !== "visible") return;
      warmTimer = window.setTimeout(
        () => {
          void import("./request")
            .then((m) => m.warmAmbientCreative())
            .catch(() => {
              /* The real path still fetches — this is only a head start. */
            });
        },
        Math.max(1000, Math.round(idleMs * WARM_AT)),
      );
      timer = window.setTimeout(fire, idleMs);
    };
    const ACTIVITY = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
      // no bare "scroll": the app scrolls itself on a return (the feed restoring its position) —
      // a real scroll always starts with a touch, a wheel or a key (2026-10-14)
    ] as const;
    /*
      🔴 NOT ON RETURN (owner, 2026-10-14: "the back to the app interstitial is still happening.
      When I enter the app back from outside, I said stop it"). Coming back to the app, or the app
      loading fresh, used to restart this countdown, so the first thing after re-entering — a few
      seconds of not touching anything — was a full-screen ad. The countdown now starts only from a
      real interaction on this visit, and going to the background stops it; becoming visible again
      starts nothing.
    */
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        window.clearTimeout(timer);
        window.clearTimeout(warmTimer);
      }
    };
    const onScroll = () => {
      const now = Date.now();
      if (!scrollIsGesture(now, gestureAt)) return;
      // the chain extends itself, so a long fling counts to its last frame; re-armed at most every 250ms
      gestureAt = now;
      if (now - armedAt >= 250) arm();
    };
    for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);

    /*
      BACK-SWIPE. `popstate` is the one signal that covers the iOS edge-swipe,
      the Android back gesture and the browser's own back button alike.

      🔴 It does NOT trap the back navigation. The page has already changed by
      the time this fires — the ad appears over the destination, and the visitor
      can still leave. Anything that cancelled or re-pushed history here would be
      the back-button trap the PWA work has removed twice.
    */
    const onPop = () => fire();
    window.addEventListener("popstate", onPop);

    // no arm() here: a fresh load (often a return to the app) starts no countdown until the visitor interacts
    return () => {
      window.clearTimeout(timer);
      // The warm timer too — a route change must not leave a pending fetch for
      // a moment that can no longer happen.
      window.clearTimeout(warmTimer);
      for (const e of ACTIVITY) window.removeEventListener(e, arm);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("popstate", onPop);
    };
  }, [idleMs]);

  return null;
}
