"use client";

import { getSyncConditions } from "@/lib/media/network-conditions";

/**
 * Warms the browser's HTTP cache with the FIRST FEW MEGABYTES of a video, so
 * the full-screen reel deck opens on bytes it already has instead of a fresh
 * network fetch.
 *
 * Owner, 2026-08-26: "every video watching on feed should automatically
 * download and clear the path for reels so when is clicked it doesnt load a
 * bit."
 *
 * ── Why a ranged fetch, and why only a PREFIX ──────────────────────────────
 *
 * The clip a viewer is actually watching in the feed needs nothing from this:
 * playing it already streams its bytes, and `media.frenzsave.com` serves
 * `Cache-Control: public, max-age=31536000, immutable` (verified live
 * 2026-08-26, alongside `Accept-Ranges: bytes` and a Cloudflare range HIT), so
 * the reel viewer's own `<video>` re-reads them from cache. What is NOT warm is
 * the clip AFTER it — the one the first swipe lands on — because in the feed it
 * is still below the fold on `preload="metadata"`, which fetches headers only.
 * That first swipe is the "loads a bit" this closes.
 *
 * A prefix rather than the whole file is a deliberate, stated trade: feed clips
 * here run to ~8 MB (measured on a live post), and pulling every one in full
 * would cost a phone user tens of megabytes for videos they may never open. The
 * prefix covers the moov atom plus the opening seconds — which is all that
 * stands between a tap and a first frame — and playback streams the rest
 * normally once it starts.
 *
 * 🔴 NEVER call this for a clip that is currently PLAYING. A parallel fetch of
 * a URL the media element is already streaming can miss its range pattern and
 * pull the same bytes twice. The playing clip is the one case that needs no
 * help; see the callers in `feed-video.tsx`, which warm the NEXT clip only.
 */

/** URLs already warmed (or in flight) this session — never fetched twice. */
const warmed = new Set<string>();
const inflight = new Map<string, AbortController>();

/**
 * How much of a clip to pull. Enough for the container header and the opening
 * seconds at feed bitrates; small enough that warming a handful of clips stays
 * well inside what a single autoplaying feed already spends.
 */
const PREFIX_BYTES = 2 * 1024 * 1024;

/**
 * Ceiling for one page-session, across every URL.
 *
 * The backstop that keeps a long scroll from turning into an unbounded
 * download: a viewer who scrolls a hundred clips warms the first twelve and
 * then this stops paying out. Without it "warm the next clip" quietly becomes
 * "download the entire feed" on a long session.
 */
const SESSION_BUDGET_BYTES = 24 * 1024 * 1024;
let spentBytes = 0;

/** Data Saver and slow radios opt out entirely — same gate `prefetchImage` uses. */
function allowedByNetwork(): boolean {
  const { saveData, effectiveType } = getSyncConditions();
  if (saveData) return false;
  return effectiveType !== "slow-2g" && effectiveType !== "2g" && effectiveType !== "3g";
}

/**
 * Warm `url` in the background. Safe to call repeatedly — deduped by URL, and
 * a no-op once the session budget is spent, on a constrained connection, or
 * off the main thread's idle time.
 *
 * Failures are silent by design: this is an optimisation, and the reel viewer
 * fetches the clip itself regardless.
 */
export function prefetchVideo(url: string | null | undefined): void {
  if (!url || typeof window === "undefined") return;
  if (warmed.has(url)) return;
  if (spentBytes >= SESSION_BUDGET_BYTES) return;
  if (!allowedByNetwork()) return;

  warmed.add(url);
  const controller = new AbortController();
  inflight.set(url, controller);

  /*
    `priority: "low"` matters more than it looks: without it this competes with
    the clip the viewer is watching RIGHT NOW for the same connection, and the
    prefetch for a video they may never open would stutter the one they are
    actually watching. Not every browser honours it, which is why the byte
    ceiling above does the real enforcement.
  */
  void fetch(url, {
    signal: controller.signal,
    priority: "low",
    headers: { Range: `bytes=0-${PREFIX_BYTES - 1}` },
    credentials: "omit",
  })
    .then(async (res) => {
      // 206 is the expected answer; a 200 means the origin ignored the range
      // and is about to hand over the WHOLE file, which is exactly what the
      // prefix exists to avoid. Drop it rather than read it.
      if (res.status !== 206 || !res.body) {
        controller.abort();
        return;
      }
      // Draining the body is what actually commits it to the HTTP cache —
      // a response left unread may never be stored.
      const buf = await res.arrayBuffer();
      spentBytes += buf.byteLength;
    })
    .catch(() => {
      /* aborted, offline, CORS — the viewer still fetches normally */
    })
    .finally(() => {
      inflight.delete(url);
    });
}

/**
 * Abort an in-flight warm — called when the clip that requested it scrolls out
 * of range, so a fast scroll past twenty cards doesn't leave twenty fetches
 * racing the video the viewer actually stopped on.
 *
 * The URL stays in `warmed`: a cancelled warm is not worth retrying on the next
 * scroll-by, and re-arming it is how a jittery scroll turns into a fetch storm.
 */
export function cancelVideoPrefetch(url: string | null | undefined): void {
  if (!url) return;
  inflight.get(url)?.abort();
  inflight.delete(url);
}

/** Test seam — resets dedupe + budget between cases. */
export function __resetVideoPrefetch(): void {
  warmed.clear();
  for (const c of inflight.values()) c.abort();
  inflight.clear();
  spentBytes = 0;
}
