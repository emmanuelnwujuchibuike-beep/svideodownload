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
 *   - only TWO clips, the first buffered (`auto`), the second headers-only
 *     (`metadata`) — a swipe away.
 * A 1px, transparent, out-of-flow <video> actually loads; `display:none` would not.
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
      {urls.slice(0, 2).map((u, i) => (
        <video
          key={u}
          src={u}
          preload={i === 0 ? "auto" : "metadata"}
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
