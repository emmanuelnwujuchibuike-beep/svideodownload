/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /api/ads/config — FETCHED ONCE PER PAGE LOAD, NOT ONCE PER AD COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured, not guessed (Part 7, 2026-10-04): a production-build pass over the
 * AI pages at 320/360/390 reported `2× /api/ads/config` on EVERY page. Fifteen
 * files call this endpoint, each with its own `fetch("/api/ads/config")`, so a
 * page pays one request per ad component that happens to mount — and the
 * download and feed surfaces mount considerably more than two.
 *
 * It is the same JSON every time. It is public, it is per-page-load config, and
 * nothing about it changes between two reads in the same second.
 *
 * ── 🔴 THIS PATTERN WAS ALREADY HERE ───────────────────────────────────────
 *
 * `exoclick-interstitial.ts` had solved it on its own:
 *
 *     let tagPromise: Promise<…> | null = null;
 *     tagPromise ??= fetch("/api/ads/config")…
 *
 * One file memoised and fourteen did not. This is that file's idea, lifted to
 * where every caller can reach it — not a new mechanism.
 *
 * ── Why a PROMISE and not a resolved value ─────────────────────────────────
 *
 * Several ad components mount in the same tick. Caching the RESULT would still
 * let all of them fire before the first response landed; caching the in-flight
 * promise means the second caller awaits the first one's request. That is the
 * difference between "fewer requests usually" and "one request, always".
 *
 * ── It never rejects ───────────────────────────────────────────────────────
 *
 * Every existing call site ends in `.catch(() => {})` and treats a failure as
 * "no ads configured", because an ad config that cannot be read must never
 * break the page it decorates. That behaviour is preserved exactly: a non-ok
 * response, a parse failure or a network error all resolve to `{}`.
 *
 * 🔴 A failure is NOT cached. `adsConfigPromise` is cleared on the way out of a
 * failed attempt, so a page that loaded while the network was down can still
 * get its config when the next component mounts — without that, one early
 * failure would disable every ad surface for the rest of the page's life.
 */

/** The public shape is deliberately open: each caller already narrows the one field it wants. */
export type AdsConfig = Record<string, unknown>;

let adsConfigPromise: Promise<AdsConfig> | null = null;

/**
 * The public ad configuration, fetched at most once per page load.
 *
 * Drop-in for `fetch("/api/ads/config").then((r) => (r.ok ? r.json() : {}))` —
 * same resolved value, same never-throws contract.
 */
export function loadAdsConfig(): Promise<AdsConfig> {
  adsConfigPromise ??= fetch("/api/ads/config")
    .then((r) => (r.ok ? (r.json() as Promise<AdsConfig>) : ({} as AdsConfig)))
    .catch(() => {
      // Do not let one failed attempt poison the rest of the page.
      adsConfigPromise = null;
      return {} as AdsConfig;
    });
  return adsConfigPromise;
}

/**
 * Forget the cached answer.
 *
 * For the admin, which can CHANGE this config and then needs the next read to
 * see it. Not called on a normal page; a visitor's config cannot change under
 * them within a single page load.
 */
export function resetAdsConfigCache(): void {
  adsConfigPromise = null;
}
