/**
 * Rotation — entirely in the browser, on the cached payload.
 *
 * 🔴 A rotation is NEVER a request. The banner swaps every `rotationSeconds`
 * (5 s by default, the admin's number) by moving an index over the pool it
 * already holds — there is no `setInterval(fetch)` anywhere in this platform,
 * and `rotation.test.ts` scans the ads-platform code to keep it that way.
 *
 * Pure, so the rules are testable without a DOM.
 */

/**
 * How long ONE creative stays before the banner moves on (owner, 2026-10-10:
 * "video ad rotate even when they haven't played — give video ad 10 seconds to
 * play before rotating and picture ads 5 secs"). Minimums per media type; an
 * admin's longer rotation (e.g. the 15 s top banner) still wins. For a video
 * the clock starts when it actually PLAYS (SelfAdBanner); one that never starts
 * moves on after VIDEO_MIN_DWELL_SECONDS so the slot never freezes. Null = a
 * format without a timer (a new ad on every show).
 */
export const IMAGE_MIN_DWELL_SECONDS = 5;
export const VIDEO_MIN_DWELL_SECONDS = 10;

export function dwellSeconds(mediaType: string | null | undefined, rotationSeconds: number | null): number | null {
  if (!rotationSeconds || rotationSeconds <= 0) return null;
  return Math.max(rotationSeconds, mediaType === "video" ? VIDEO_MIN_DWELL_SECONDS : IMAGE_MIN_DWELL_SECONDS);
}

/** Which pool entry a rotating banner shows `elapsedMs` after it mounted. */
export function bannerIndexAt(elapsedMs: number, rotationSeconds: number | null, count: number): number {
  if (count <= 1 || !rotationSeconds || rotationSeconds <= 0 || !(elapsedMs > 0)) return 0;
  return Math.floor(elapsedMs / (rotationSeconds * 1000)) % count;
}

/** Milliseconds until the next swap — what the component's single setTimeout waits. */
export function msUntilNextRotation(elapsedMs: number, rotationSeconds: number | null, count: number): number | null {
  if (count <= 1 || !rotationSeconds || rotationSeconds <= 0) return null;
  const period = rotationSeconds * 1000;
  return period - (Math.max(0, elapsedMs) % period);
}

/**
 * The next interstitial / reward video: round-robin in slot order, starting
 * after the one shown last, so the same ad never plays twice in a row while
 * another is available (Ad 1, Ad 2, Ad 3 … never Ad 1, Ad 1). With no history
 * the start is spread by `random` so every slot gets its share of first views.
 */
export function pickNextNoRepeat<T extends { cr: string }>(pool: readonly T[], lastCreativeId: string | null, random: () => number = Math.random): T | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;
  const last = lastCreativeId ? pool.findIndex((a) => a.cr === lastCreativeId) : -1;
  const start = last >= 0 ? last + 1 : Math.floor(random() * pool.length);
  return pool[start % pool.length]!;
}

/** Frequency limit: may another interstitial show yet? `minGapSeconds` is the format's admin value. */
export function gapElapsed(lastShownAt: number | null, minGapSeconds: number, now: number): boolean {
  return lastShownAt === null || minGapSeconds <= 0 || now - lastShownAt >= minGapSeconds * 1000;
}
