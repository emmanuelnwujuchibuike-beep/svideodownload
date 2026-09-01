"use client";

import { useEffect, useRef, useState } from "react";

import type { HilltopTag } from "@/lib/monetization/hilltop";

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

  useEffect(() => {
    if (!ready || !showAds || !tag || sliderLoaded) return;
    sliderLoaded = true;
    const script = document.createElement("script");
    script.src = tag.src;
    script.async = true;
    script.referrerPolicy = tag.referrerPolicy;
    (script as HTMLScriptElement & { settings?: unknown }).settings = {};
    document.body.appendChild(script);
  }, [ready, showAds, tag]);

  return null;
}
