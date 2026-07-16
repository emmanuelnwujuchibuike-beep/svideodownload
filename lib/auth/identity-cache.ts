"use client";

/**
 * The last-known signed-in identity — handle + avatar URL only — persisted to
 * localStorage so the profile button can PAINT instantly on a cold start
 * instead of flashing a grey pulse.
 *
 * Owner (2026-07-16): "the profile button in message page at the top and the
 * bottom nav profile button still reloads on back swiped, and in admin account
 * the reload is more noticeable."
 *
 * Why a disk cache is needed at all: `useUser()`/`useEntitlements()` both start
 * from nothing and hit the network on a fresh JS context, so they render a
 * placeholder first. On iOS a standalone PWA is frequently torn down and
 * relaunched (the edge-swipe-back gesture can force exactly that — see
 * register-sw.tsx's note), and every relaunch is a genuine cold start with an
 * empty module cache. That's why this reads as "reloads on back swipe" on the
 * webapp specifically. An admin account feels worse because it renders more
 * chrome behind the same gate.
 *
 * SCOPE — deliberately identity-only:
 *   - handle + avatarUrl are cosmetic. Showing a stale avatar for the ~100ms
 *     until `/api/me` answers is harmless and self-correcting.
 *   - plan / isPremium / showAds are NOT stored here, on purpose. A stale
 *     "premium" would hide ads from a free viewer, and ad rendering is the
 *     platform's income — it must never be decided from unverified disk state.
 *     Those keep their existing fetch-then-default-to-free path untouched.
 *
 * Nothing here is trusted for AUTHORIZATION: it only decides what to paint for
 * a frame. Every real action still goes through the server session.
 */

const KEY = "frenz-identity";

export interface CachedIdentity {
  handle: string | null;
  avatarUrl: string | null;
}

export function readIdentity(): CachedIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedIdentity>;
    const handle = typeof parsed.handle === "string" ? parsed.handle : null;
    const avatarUrl = typeof parsed.avatarUrl === "string" ? parsed.avatarUrl : null;
    if (!handle && !avatarUrl) return null;
    return { handle, avatarUrl };
  } catch {
    return null;
  }
}

export function writeIdentity(identity: CachedIdentity): void {
  try {
    if (!identity.handle && !identity.avatarUrl) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable/full — the button just falls back to its placeholder */
  }
}

/** Called on a real sign-out so the next visitor never sees the last user's
 *  face for a frame. */
export function clearIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
