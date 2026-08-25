"use client";

/**
 * Ensures only ONE video plays at a time across the feed and reels. When any
 * player starts, it "claims" playback and the previously-playing element is
 * paused. This keeps the feed calm (no wall of simultaneously-playing clips) and
 * saves bandwidth/CPU on mobile.
 *
 * `Claimable` rather than `HTMLMediaElement` so a Cloudflare Stream iframe (no
 * reachable `<video>` element to call `.pause()` on across the origin boundary)
 * can register a callback-backed handle and participate in the same mutual
 * exclusion as a real element — see smart-video.tsx / feed-video.tsx's
 * `iframeMode`.
 */
export interface Claimable {
  pause(): void;
  play?(): void | Promise<void>;
  readonly paused?: boolean;
}

let active: Claimable | null = null;

export function claimPlayback(handle: Claimable): void {
  if (active && active !== handle) {
    try {
      active.pause();
    } catch {
      /* element/handle may be gone */
    }
  }
  active = handle;
}

export function releasePlayback(handle: Claimable): void {
  if (active === handle) active = null;
}

/**
 * Occlusion gate: a full-screen surface mounted OVER the feed/reels (the post
 * viewer, image viewer, reel deck) calls this on mount and releases it on
 * unmount. It immediately pauses whatever was playing underneath, and — while
 * held — tells the still-mounted feed's own visibility-driven autoplay to stay
 * quiet, even though its IntersectionObserver still geometrically sees itself
 * as "in view" (IO has no concept of z-index/occlusion, and the feed is never
 * unmounted under these surfaces, only covered — see smart-feed.tsx).
 *
 * Reference-counted so two overlays opening in quick succession (a viewer
 * launching a second sheet) can't have the first one's cleanup re-arm the feed
 * while the second is still open.
 */
let suspendCount = 0;
export function suspendPlayback(): () => void {
  suspendCount += 1;
  if (active) {
    try {
      active.pause();
    } catch {
      /* gone */
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspendCount = Math.max(0, suspendCount - 1);
  };
}

export function isSuspended(): boolean {
  return suspendCount > 0;
}

/**
 * Battery/thermal saver: when the tab/app goes to the background, immediately
 * pause the one playing video (no point decoding frames nobody can see) and
 * resume it when the user comes back. One listener for the whole app.
 */
let resumeOnReturn = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        if (active) {
          // A handle without a real `.paused` (an iframe callback) can't tell
          // us whether it was actually playing — assume it was rather than
          // skip the resume-on-return, since pausing an already-paused thing
          // is harmless either way.
          resumeOnReturn = active.paused !== true;
          try {
            active.pause();
          } catch {
            /* gone */
          }
        }
      } else if (resumeOnReturn && active && !isSuspended()) {
        resumeOnReturn = false;
        try {
          void active.play?.()?.catch?.(() => {});
        } catch {
          /* gone */
        }
      }
    },
    { passive: true },
  );
}

/**
 * Tracks when the page last scrolled, so feed videos can ignore a "tap" that's
 * really the tail end of a scroll gesture (prevents accidentally opening a reel
 * while flicking through the feed). One passive listener for the whole app.
 */
let lastScrollAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener(
    "scroll",
    () => {
      lastScrollAt = Date.now();
    },
    { passive: true, capture: true },
  );
}

export function recentlyScrolled(withinMs = 280): boolean {
  return Date.now() - lastScrollAt < withinMs;
}

/**
 * Records a view for a post the first time it's actually watched this session
 * (in the feed or reels), so view counts reflect real watches — not just visits
 * to the post page. Deduped client-side (once per post per session) and again at
 * the DB level (per viewer|ip per day), so it can never inflate.
 */
const viewed = new Set<string>();
export function recordView(postId: string): void {
  if (!postId || viewed.has(postId)) return;
  viewed.add(postId);
  try {
    fetch(`/api/posts/${postId}/view`, { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Reports watch depth (Feature 15 Part 8) — how much of a post was actually
 * watched, not just that it was seen. Called at natural pause points (onPause,
 * unmount) alongside `savePlaybackPosition`, which already has the exact
 * `currentTime`/`duration` this needs. NOT deduped like `recordView` above —
 * a rewatch to completion is a genuinely stronger signal than a first partial
 * watch — but throttled per-post so a flurry of pause/resume taps doesn't
 * spam the endpoint: only reported once progress has advanced meaningfully
 * (2s) since the last report for that post this session.
 */
const lastWatchReportMs = new Map<string, number>();
export function recordWatch(postId: string | undefined, watchMs: number, durationMs: number, source?: string): void {
  if (!postId || !Number.isFinite(watchMs) || watchMs <= 0) return;
  const last = lastWatchReportMs.get(postId) ?? -Infinity;
  if (watchMs - last < 2000) return;
  lastWatchReportMs.set(postId, watchMs);
  try {
    fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ postId, watchMs: Math.round(watchMs), durationMs: Math.round(durationMs || 0), source }),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/**
 * Dev-only safety net (never runs in production): periodically scans every
 * `<video>` in the document and, if more than one is genuinely playing at
 * once, pauses every one except whichever the coordinator currently considers
 * `active` — logging so the offending component gets fixed rather than
 * silently tolerated. This catches a FUTURE component that plays a `<video>`
 * without ever calling `claimPlayback`, which is exactly the class of bug that
 * caused the original "two videos at once" report (some render paths never
 * called into this module at all).
 */
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  window.setInterval(() => {
    const playing = Array.from(document.querySelectorAll("video")).filter((v) => !v.paused && !v.ended);
    if (playing.length <= 1) return;
    const keep = (active as HTMLMediaElement | null) ?? playing[0]!;
    for (const v of playing) {
      if (v === keep) continue;
      // eslint-disable-next-line no-console
      console.warn(
        "[video-coordinator] more than one <video> is playing at once — this element never called claimPlayback():",
        v,
      );
      v.pause();
    }
  }, 2000);
}
