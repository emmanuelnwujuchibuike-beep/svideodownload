"use client";

import { useEffect, useState } from "react";

/**
 * Warms the first reels ahead of the tap, so opening /reels (from the bottom nav or
 * the hero phone's reels tile) lands on video, not a spinner (owner: "make the reels
 * page always warm up and load the first 2 videos ahead before the reels button is
 * clicked").
 *
 * The gating is the same the old in-hero deck used, and it is load-bearing rather
 * than fussy — a stranger's cellular data is not ours to spend uninvited, and the
 * egress cap on this project has been hit before:
 *   - only AFTER the load event (critical resources done) and on idle;
 *   - only on Save-Data:off, effectiveType 4g and measured downlink ≥ 2.5 Mbps;
 *   - only TWO clips, and only their HEADERS.
 * A 1px, transparent, out-of-flow <video> actually loads; `display:none` would not.
 *
 * ── Why `metadata` and never `auto` (owner Lighthouse run, 2026-08-09) ───────
 *
 * The first clip used the `auto` preload value, which does not mean "preload
 * eagerly" — it means **download the entire file**. Measured against production on that
 * date, the two clips this component warms were 11.4 MB and 1.7 MB. So this one
 * component was pulling ~13.1 MB of the landing page's 14.5 MB total payload,
 * which is essentially all of Lighthouse's "Avoid enormous network payloads",
 * and it competed for bandwidth and decoder time with everything else — landing
 * TTI measured 9.4 s.
 *
 * All of that was spent on a page where most visitors never tap Reels at all.
 *
 * `metadata` still buys the thing the warm-up exists for. It resolves DNS,
 * completes the TLS handshake to the media host, and fetches the container
 * header — so tapping Reels starts a byte-range request on an already-open
 * connection to an already-parsed file, instead of starting from cold. The
 * remaining cost is a few hundred KB rather than eleven megabytes.
 *
 * If a fully-buffered first frame is ever wanted again, the answer is a short
 * `Range` request for the opening segment, NOT `auto` — `auto` has no ceiling
 * and scales with whatever the largest reel happens to be that day.
 */

const MIN_DOWNLINK_MBPS = 2.5;

function shouldWarm(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
    }
  ).connection;
  if (!c) return false;
  if (c.saveData) return false;
  if (c.effectiveType !== "4g") return false;
  return typeof c.downlink === "number" && c.downlink >= MIN_DOWNLINK_MBPS;
}

export function ReelsWarmup({ urls }: { urls: string[] }) {
  const [warm, setWarm] = useState(false);

  useEffect(() => {
    if (urls.length === 0 || !shouldWarm()) return;
    let cancelled = false;
    let idleId = 0;
    let timerId = 0;
    const start = () => {
      if (!cancelled) setWarm(true);
    };
    const afterLoad = () => {
      if (cancelled) return;
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(start);
      else timerId = window.setTimeout(start, 1200);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", afterLoad);
      if (idleId) window.cancelIdleCallback(idleId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [urls]);

  if (!warm) return null;

  return (
    <>
      {urls.slice(0, 2).map((u) => (
        <video
          key={u}
          src={u}
          /* NEVER "auto" — see the header note. `auto` downloads the whole file. */
          preload="metadata"
          muted
          playsInline
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        />
      ))}
    </>
  );
}
