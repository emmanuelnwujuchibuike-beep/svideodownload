/* Shared helpers every caching strategy builds on — cache integrity (never
 * store a response we shouldn't), quota safety (never let a storage failure
 * break the actual network response), and bounded growth (per-cache entry
 * caps). */
var SWX = (self.SWX = self.SWX || {});

// Cache.keys() returns insertion order, so this trims oldest-first.
SWX.trimCache = async function trimCache(name, max) {
  if (!max) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
};

// "opaque" = a no-cors cross-origin response (thumbnails from whatever CDN
// yt-dlp resolved) — status/body are unreadable but the browser already
// fetched the bytes, so it's still valid to cache.
SWX.isCacheable = function isCacheable(response) {
  return !!response && (response.ok || response.type === "opaque");
};

// Every cache write goes through this — never throws. A storage-quota
// error, a third-party opaque response, or a mid-write cache-deletion race
// (activate() cleaning up an old version) must never fail the network
// response the user already received; caching is always best-effort.
SWX.safePut = async function safePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    if (SWX.LIMITS[cacheName]) await SWX.trimCache(cacheName, SWX.LIMITS[cacheName]);
    return true;
  } catch (err) {
    SWX.log("cache write skipped", cacheName, err && err.name);
    return false;
  }
};
