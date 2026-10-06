/**
 * The on-device AI keys, and the one call that forgets them at sign-out.
 *
 * 🔴 Kept apart from `history-store.ts` / `media-url-cache.ts` on purpose:
 * `lib/auth/sign-out.ts` is imported by the site header on EVERY page, so
 * whatever it imports ships in every route's first-load JS. Importing the
 * stores themselves put the whole history store on /admin and the landing
 * (budget.test caught /admin at 370 kB > 369 kB, 2026-10-06). Sign-out only
 * needs the keys. The history store re-reads storage and owner-checks it, so
 * a removed key is an empty list the next time anything looks.
 */

export const AI_HISTORY_KEY = "frenzsave_ai_history_v2";
export const AI_MEDIA_URLS_KEY = "frenzsave_ai_media_urls_v1";

export function forgetAiDeviceData(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AI_HISTORY_KEY);
  } catch {
    /* storage blocked — nothing stored */
  }
  try {
    window.sessionStorage.removeItem(AI_MEDIA_URLS_KEY);
  } catch {
    /* storage blocked — nothing stored */
  }
}
