"use client";

import { useEffect, useRef, useState } from "react";

import type { HilltopTag } from "@/lib/monetization/hilltop";

import { afterLoadIdle } from "@/lib/monetization/after-load";
import { installPopunderGuard } from "@/lib/monetization/popunder-guard";

import { useShowAds } from "./use-show-ads";

/**
 * The HilltopAds MultiTag Video Slider — site-wide, once per page.
 *
 * Owner, 2026-09-01: "we will also use hiltop vast video and video slider too."
 *
 * ── Why it has no slot ────────────────────────────────────────────────────────
 *
 * The slider PLACES ITSELF: their script slides a small video player into a
 * corner of the viewport on the network's own schedule. There is no position for
 * an operator to choose, which is why it is loaded once from the shell rather
 * than dropped into a page slot — an admin control whose output renders wherever
 * the network likes is not a placement, and pretending otherwise is the
 * "affordance that does nothing" this codebase keeps removing.
 *
 * ── Once per page, and never twice ────────────────────────────────────────────
 *
 * 🔴 Guarded by a module-level flag as well as the effect. This component is
 * mounted from the root layout, and React's development strict mode runs effects
 * twice — which for an ad loader is two requests, two sliders and a doubled
 * impression count that quietly misreports revenue. The flag is deliberately
 * module scope, not a ref: a ref is per-instance and would not stop a second
 * mount from a re-rendered layout.
 *
 * It is never torn down. The slider is the network's element, positioned by
 * them, and removing our script tag under it mid-playback would leave an orphan
 * or kill an impression that was already counted.
 */
let sliderLoaded = false;

export function HilltopVideoSlider() {
  const { showAds, ready } = useShowAds();
  const [tag, setTag] = useState<HilltopTag | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltopVideoSlider?: HilltopTag | null }) => {
        if (alive) setTag(d.hilltopVideoSlider ?? null);
      })
      .catch(() => {
        /* No slider is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
    🔴 AFTER `load`, NEVER BEFORE IT (owner, 2026-09-01: "i think we have broken
    the lcp" — and the measurement agreed: FCP 5432ms, LCP 8112ms, with five
    massivesalad.com requests made WHILE THE PAGE WAS STILL LOADING).

    This is site-wide, so it runs on the landing page — the one route held to a
    1.6s budget — and it was injecting its script the moment its config arrived.
    Third-party JavaScript parsing and executing on the main thread inside the
    window that decides LCP.

    The standing law in this codebase is that ad creatives wait for `load`,
    recorded after the same mistake cost ~340ms of LCP on 2026-08-30. This unit
    was written without it. `afterLoadIdle` also waits for the first idle moment
    after that, because `load` alone lands the work exactly when the main thread
    is catching up on everything it deferred.
  */
  useEffect(() => {
    if (!ready || !showAds || !tag || sliderLoaded) return;
    return afterLoadIdle(() => {
      if (sliderLoaded) return;
      sliderLoaded = true;
      /*
        🔴 BEFORE the network script, never after (owner, 2026-09-02: "disable
        hiltop popunder that is included in video slider … i dont want hiltop
        popunder to cause harm to my adsense newly application").

        The MultiTag bundle can carry a pop-under alongside the player, and it
        binds its handler as soon as it runs. Installing the guard after that
        point would leave the first click through.
      */
      installPopunderGuard();
      const script = document.createElement("script");
      script.src = tag.src;
      script.async = true;
      script.referrerPolicy = tag.referrerPolicy;
      (script as HTMLScriptElement & { settings?: unknown }).settings = {};
      document.body.appendChild(script);
    });
  }, [ready, showAds, tag]);

  return null;
}
