"use client";

/**
 * Ensures only ONE video plays at a time across the feed and reels. When any
 * player starts, it "claims" playback and the previously-playing element is
 * paused. This keeps the feed calm (no wall of simultaneously-playing clips) and
 * saves bandwidth/CPU on mobile.
 */
let active: HTMLMediaElement | null = null;

export function claimPlayback(el: HTMLMediaElement): void {
  if (active && active !== el) {
    try {
      active.pause();
    } catch {
      /* element may be gone */
    }
  }
  active = el;
}

export function releasePlayback(el: HTMLMediaElement): void {
  if (active === el) active = null;
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
        if (active && !active.paused) {
          resumeOnReturn = true;
          try {
            active.pause();
          } catch {
            /* gone */
          }
        }
      } else if (resumeOnReturn && active) {
        resumeOnReturn = false;
        void active.play().catch(() => {});
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
