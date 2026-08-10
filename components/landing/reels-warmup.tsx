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
 * ── No <video> element at all any more (owner Lighthouse run, 2026-08-10) ────
 *
 * History, because the second attempt is the instructive one:
 *
 *   1. It used `preload="auto"`, which does not mean "preload eagerly" — it
 *      means download the ENTIRE file. The two clips are 11.4 MB and 1.7 MB, so
 *      this component alone was ~13 MB of a 14.5 MB landing payload.
 *   2. That became `preload="metadata"`, which should cost ~40 KB. The next
 *      Lighthouse run came back at 14,920 KiB — essentially unchanged.
 *
 * The excuse for (2) does not exist here: the media host answers Range requests
 * with 206, and the MP4's `moov` atom is at byte 36, so metadata is genuinely
 * cheap to obtain. Both were verified with curl before this rewrite.
 *
 * The lesson is that `preload` is a HINT. It is advice a browser may take, and
 * on a muted, in-DOM, playable <video> element browsers routinely buffer well
 * past what the attribute asks for. Tuning a hint and re-measuring is a loop
 * with no end, because the ceiling is not ours to set.
 *
 * So there is no media element. Warming is done explicitly:
 *
 *   • `preconnect` to the media origin — DNS + TCP + TLS, ZERO bytes. This is
 *     most of the cold-start cost on a phone and all of it is recovered here.
 *   • one bounded `Range: bytes=0-<WARM_BYTES>` fetch per clip. The response is
 *     `immutable`, so the reels player reuses it from the HTTP cache instead of
 *     starting cold.
 *
 * The ceiling is now a number in this file rather than a browser's judgement:
 * two clips × 96 KB = at most 192 KB, and it cannot scale with whatever the
 * largest reel happens to be that day. That is the property the previous two
 * versions both lacked.
 */

const MIN_DOWNLINK_MBPS = 2.5;

/**
 * How much of each clip to pull.
 *
 * Enough for the container header and the opening frames — the part that makes
 * a tap feel instant — and small enough that the whole warm-up costs less than
 * one of the landing's own images. Deliberately a constant: the entire point of
 * this rewrite is that the budget is stated here and enforced, not requested.
 */
const WARM_BYTES = 96 * 1024;

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

/** The origin serving the clips, for the preconnect. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function ReelsWarmup({ urls }: { urls: string[] }) {
  const [origins, setOrigins] = useState<string[]>([]);

  useEffect(() => {
    if (urls.length === 0 || !shouldWarm()) return;
    const controller = new AbortController();
    let idleId = 0;
    let timerId = 0;

    const clips = urls.slice(0, 2);

    const start = () => {
      // Open the connections first — a preconnect that lands after the fetch it
      // was meant to accelerate has done nothing.
      setOrigins([...new Set(clips.map(originOf).filter((o): o is string => !!o))]);

      for (const url of clips) {
        /*
          A bounded range, and errors are swallowed on purpose. This is a
          speculative optimisation for a tap that may never come: a media host
          hiccup must never surface as an error on the landing page, and there
          is nothing for a visitor to do about it.
        */
        void fetch(url, {
          headers: { Range: `bytes=0-${WARM_BYTES - 1}` },
          signal: controller.signal,
          // Same-origin credentials are meaningless on a public media CDN and
          // would defeat caching.
          credentials: "omit",
          priority: "low",
        } as RequestInit).catch(() => {});
      }
    };

    const afterLoad = () => {
      if (controller.signal.aborted) return;
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(start);
      else timerId = window.setTimeout(start, 1200);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });

    return () => {
      controller.abort();
      window.removeEventListener("load", afterLoad);
      if (idleId) window.cancelIdleCallback(idleId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [urls]);

  /*
    Zero bytes, and rendered only once the warm-up has actually begun. React
    hoists these into <head>, so the handshake is already done by the time the
    reels player asks for its first segment.
  */
  return (
    <>
      {origins.map((origin) => (
        <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
      ))}
    </>
  );
}
