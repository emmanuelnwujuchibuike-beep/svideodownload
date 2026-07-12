/* Install / activate / update-promotion — the "never leave the user with a
 * broken or half-installed cache" half of the enterprise ask. */
var SWX = (self.SWX = self.SWX || {});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Resilient precache: fetch+put each URL independently instead of
      // cache.addAll() — addAll is atomic, so a single 404/network blip
      // would abort the ENTIRE install and leave the worker stuck retrying
      // forever. A missing asset here just means it warms in on first real
      // request instead (see routes.js's image strategy). Written into
      // IMAGE_CACHE, matching where routes.js will actually look these up
      // at runtime (they're all image requests) — precaching into a
      // different cache than the one that gets read back would be no-op work.
      const cache = await caches.open(SWX.IMAGE_CACHE);
      const results = await Promise.allSettled(
        SWX.PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { cache: "no-store" });
          if (!SWX.isCacheable(res)) throw new Error(`bad response for ${url}`);
          await cache.put(url, res);
        }),
      );
      results.forEach((r, i) => {
        if (r.status === "rejected") SWX.log("precache skipped:", SWX.PRECACHE_URLS[i], r.reason);
      });
      SWX.log("installed", SWX.VERSION);
      await self.skipWaiting();
    })(),
  );
});

// The page can tell a freshly-installed worker to take over now (instead of
// waiting for every tab to close) — powers instant updates on open laptop tabs.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || (event.data && event.data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // allSettled, not all() — one cache failing to delete must never block
      // the rest of activation (clients.claim(), navigation preload) from
      // completing; a stray cache gets swept up on the next activation instead.
      await Promise.allSettled(keys.filter((k) => !SWX.KEEP.includes(k)).map((k) => caches.delete(k)));

      // Navigation preload: the browser starts the navigation request in
      // parallel with SW boot instead of after it — shaves the worker's cold
      // start (easily 100ms+ in an installed app) off every page open.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }
      await self.clients.claim();
      SWX.log("activated", SWX.VERSION);
    })(),
  );
});
