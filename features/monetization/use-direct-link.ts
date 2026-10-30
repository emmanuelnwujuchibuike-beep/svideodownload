"use client";

import { useCallback, useEffect, useRef } from "react";

import { useShowAds } from "@/features/monetization/use-show-ads";
import type { DirectLinkSpot } from "@/lib/monetization/direct-link";
import { CDN_BUCKET_MS, cdnBucket } from "@/lib/net/cdn-bucket";
import type { SpotOutcome } from "@/lib/monetization/spot-popunder";

type Opener = (onOutcome?: (o: SpotOutcome) => void) => boolean;

/** Just past the next bucket edge, the read lands inside the NEW bucket (a fresh URL, so a fresh config). */
export const BUCKET_EDGE_SLACK_MS = 1000;

/** Milliseconds until just after the next CDN bucket edge — never five minutes from whenever the spot mounted. */
export function msUntilNextBucket(now: number): number {
  return CDN_BUCKET_MS - (now % CDN_BUCKET_MS) + BUCKET_EDGE_SLACK_MS;
}

interface VisibilityDoc {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Runs `load` again just past every CDN bucket edge while the page is visible; a tab coming back re-runs it at once if
 * a bucket turned while it was hidden. Nothing runs in a hidden tab. Returns the stop function.
 */
export function startBucketRefresh(load: () => void, doc: VisibilityDoc = document, now: () => number = Date.now): () => void {
  let readIn = cdnBucket(now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    if (doc.visibilityState === "hidden") return;
    if (cdnBucket(now()) !== readIn) {
      readIn = cdnBucket(now());
      load();
    }
    timer = setTimeout(refresh, msUntilNextBucket(now()));
  };
  refresh();
  doc.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", refresh);
  };
}

/**
 * The ad formats at one spot: the Monetag POP-UNDER first, the direct link as its backup
 * (lib/monetization/spot-popunder.ts, lib/monetization/direct-link.ts).
 *
 * Returns `maybeOpen`, to call INSIDE a tap's own handler: browsers only let a new tab open within
 * the gesture, so the opener is loaded ahead (its own chunk, direct-link-runtime.ts, after mount)
 * and the call never awaits. It answers whether anything is set up here; `onOutcome` says what
 * actually opened ("popunder" | "direct" | "none"). Free plan only (no placement passed to
 * useShowAds), and never on the sign-in/profile routes. Every tap at the spot may open (no lock).
 * The element carrying the spot should have `data-ad-spot={spot}` so a press arms the pop-under early.
 */
export function useDirectLink(spot: DirectLinkSpot | null): (onOutcome?: (o: SpotOutcome) => void) => boolean {
  const { showAds, ready } = useShowAds();
  const opener = useRef<Opener | null>(null);

  useEffect(() => {
    if (!spot || !ready || !showAds) return;
    let alive = true;
    const load = () =>
      void import("./direct-link-runtime")
        .then((m) => m.loadDirectLinkOpener(spot))
        .then((open) => {
          if (alive) opener.current = open;
        })
        .catch(() => {
          /* No link is the safe direction. */
        });
    load();
    /*
      A spot that stays on screen (the result card's Download button) re-reads the admin's choice as the shared config
      refreshes (lib/monetization/ads-config-client.ts, one read per 5-min CDN bucket): a link or pop-under switched off
      stops opening without a relaunch (owner, 2026-10-29). Still one shared request per window, however many spots.

      Timed to the bucket EDGE and paused in a hidden tab (code review, 2026-10-30). A plain 5-minute interval from mount
      could fire just BEFORE an edge — re-reading the old bucket — and only see the new config five minutes later, so a
      switch turned off kept firing for up to ten; and it kept importing, rebuilding and re-watching in background tabs.
      Now each spot re-reads once just past every edge while the tab is visible, and a tab coming back re-reads at once
      if a bucket turned while it was hidden (startBucketRefresh).
    */
    const stopRefresh = startBucketRefresh(load);
    return () => {
      alive = false;
      stopRefresh();
      opener.current = null;
    };
  }, [ready, showAds, spot]);

  // true when this spot has something set up (a pop-under to try, or a direct link to roll); false = nothing to open
  return useCallback((onOutcome?: (o: SpotOutcome) => void) => {
    if (!opener.current) return false;
    return opener.current(onOutcome);
  }, []);
}

/**
 * A close control that first opens the spot's ad (owner, 2026-10-20: "make the whole X button open
 * the Monetag direct link and still close the ad when the user comes back"; 2026-10-23: the pop-under
 * first, the direct link its backup). A pop-under opens BEHIND this tab, so the ad closes at once; a
 * direct link opens in front, so the ad closes when this tab is visible again — or after 4 s if it never
 * went hidden (a blocked pop-up), so the control can never leave the ad stuck. Nothing set up → it closes.
 */
export function useCloseViaDirectLink(spot: DirectLinkSpot | null, close: () => void): () => void {
  const openDirectLink = useDirectLink(spot);
  return useCallback(() => {
    const waitForReturn = () => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        document.removeEventListener("visibilitychange", onVisible);
        window.clearTimeout(timer);
        close();
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") finish();
      };
      const timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") finish();
      }, 4000);
      document.addEventListener("visibilitychange", onVisible);
    };
    const handled = openDirectLink((outcome) => (outcome === "direct" ? waitForReturn() : close()));
    if (!handled) close();
  }, [openDirectLink, close]);
}
