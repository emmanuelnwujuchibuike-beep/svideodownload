/**
 * Keeps each History thumbnail on the device after it first loads (owner,
 * 2026-10-14: "medias should be save in local storage so it doesn't load each
 * time is opening after the first prefetched and opening").
 *
 * Cache Storage, not localStorage: localStorage is ~5 MB of strings, and these
 * are cross-origin CDN images the page can't read as bytes anyway. The service
 * worker answers every image request from this cache first (public/sw/routes.js),
 * so a thumbnail seen once paints from the device on every later visit, and
 * keeps showing after the source CDN link has expired.
 *
 * The name must match `SWX.HISTORY_THUMB_CACHE` (public/sw/config.js). Its
 * `frenz-img-` prefix is what sign-out deletes.
 */
export const HISTORY_THUMB_CACHE = "frenz-img-history-1";
/** Oldest-first trim. Browsers count an opaque entry as several MB of quota, so this stays modest. */
export const HISTORY_THUMB_MAX = 200;

const kept = new Set<string>();

export function keepHistoryThumb(src: string | null | undefined): void {
  if (!src || kept.has(src) || !/^https?:\/\//.test(src)) return;
  if (typeof caches === "undefined") return;
  kept.add(src);
  const run = async () => {
    const cache = await caches.open(HISTORY_THUMB_CACHE);
    if (await cache.match(src)) return;
    // no-cors: the same opaque response the <img> got, which an <img> can be answered with
    const res = await fetch(src, { mode: "no-cors", credentials: "omit" });
    if (res.type !== "opaque" && !res.ok) return;
    await cache.put(src, res);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - HISTORY_THUMB_MAX; i++) await cache.delete(keys[i]!);
  };
  const go = () => void run().catch(() => kept.delete(src));
  // after the grid has painted — never competing with the tiles on screen
  if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}
