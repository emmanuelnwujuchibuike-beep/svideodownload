"use client";

import { useEffect, useRef } from "react";

import type { AdSlotData } from "@/lib/monetization/types";

import { prefetchZoneIds } from "@/lib/monetization/ad-schema";

import { prefetchZones } from "./ad-cache";
import { injectAdMarkup } from "./inject";

/**
 * Loads page-level ad scripts (Adsterra Social Bar / Pop-under, PropellerAds
 * OnClick / Multitag) from the `global` zone and injects them once per page
 * load. Premium users get nothing (the API returns an empty list). Renders no
 * visible UI.
 */
export function AdScripts() {
  const done = useRef(false);

  /*
    Warm the placements this page will render, immediately — NOT on idle.

    The idle deferral below is right for injecting third-party SCRIPT, which is
    heavy and competes with hydration. It is wrong for the ad DATA, which is one
    small same-origin JSON request: delaying that was a large part of why ads
    arrived after the visitor had already downloaded and left. Firing it here
    means the answer is usually cached by the time the first slot mounts.
  */
  useEffect(() => {
    // Derived from the zone registry, not listed here — a second list would
    // drift the moment a placement is added, and silently stop warming it.
    prefetchZones(prefetchZoneIds());
  }, []);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    /*
      Deferred to idle, not fired during hydration.

      MEASURED on `/`: the LCP element is the hero H1 and it paints the instant
      the first big hydration task ends — LCP tracks that task's end almost
      exactly. Anything that lengthens it moves LCP directly, and this effect
      previously kicked off a fetch and then injected third-party ad scripts
      into the document right in that window, on a connection already saturated
      by the page's own JS.

      Ads are not above-the-fold content and nothing about them needs to be
      first. Waiting for idle keeps the revenue path completely intact — the
      same request, the same injection, the same zone — while taking it out of
      the critical window.

      NOT a CSP change: the standing constraint is that ads must never be
      CSP-blocked, and this touches only WHEN they load.

      `requestIdleCallback` is unsupported on Safari before 17, hence the
      timeout fallback — without it iOS would never load an ad at all.
    */
    const start = () => {
      fetch("/api/ads?zone=global&all=1")
        .then((r) => (r.ok ? r.json() : { ads: [] }))
        .then((d) => {
          for (const ad of (d.ads ?? []) as AdSlotData[]) {
            if (ad.scriptCode) injectAdMarkup(document.body, ad.scriptCode);
          }
        })
        .catch(() => {});
    };

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const useIdle = typeof w.requestIdleCallback === "function";
    const handle = useIdle
      ? w.requestIdleCallback!(start, { timeout: 3000 })
      : window.setTimeout(start, 1500);

    return () => {
      if (useIdle && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  return null;
}
