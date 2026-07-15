/* The caching strategies themselves — routes.js decides WHICH resource gets
 * which one; this file only implements the HOW. Never mix strategies inside
 * one function: each resource class gets exactly one, chosen for what that
 * content actually needs. */
var SWX = (self.SWX = self.SWX || {});

// Cache-poisoning guard, cacheFirst only: a captive portal (airport/hotel
// wifi) intercepts a request for a .js/.css/font URL and returns its OWN
// 200 OK HTML login page instead. isCacheable() alone would accept that
// (status 200 passes .ok) and cache it FOREVER under that hashed asset's
// URL for the rest of the cache version's life — silently breaking the
// entire app until the next SW VERSION bump, even after the user gets real
// connectivity back. This is the one strategy where that risk is real and
// cheap to close: static/font assets never legitimately respond with HTML.
function looksLikeCaptivePortalResponse(response) {
  const type = response.headers.get("content-type") || "";
  return type.startsWith("text/html");
}

// Cache-first: for content-addressed / immutable assets (Next's hashed
// build output, self-hosted fonts) where the URL itself changes whenever
// the content does — a cache hit is ALWAYS correct here, so it's never
// worth re-checking the network. Fastest possible repeat load.
SWX.cacheFirst = async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (SWX.isCacheable(res) && !looksLikeCaptivePortalResponse(res)) {
    await SWX.safePut(cacheName, request, res.clone());
  } else if (looksLikeCaptivePortalResponse(res)) {
    SWX.log("skipped caching a static asset that responded with HTML — likely a captive portal", request.url);
  }
  return res;
};

// Stale-while-revalidate: for content that DOES change, but where showing
// last time's version for one extra load is a fine trade for an instant
// paint — thumbnails/avatars, and (once allowlisted) genuinely public API
// responses. Always kicks off a background refresh even when a cached copy
// answers immediately.
SWX.staleWhileRevalidate = async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then(async (res) => {
      if (SWX.isCacheable(res)) await SWX.safePut(cacheName, request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || network;
};

// Network-first: for navigations (HTML) — always prefer the live page when
// reachable (a signed-in redirect, a new deploy, or personalized content
// must never go stale), falling back to the last-good cached copy and
// finally a branded offline page only when both the network AND the cache
// miss. `preload` is the browser's navigation-preload response, started in
// parallel with SW boot — using it instead of a fresh fetch() shaves the
// worker's cold-start latency off every navigation.
//
// Hard timeout (default 20s): fetch() has no built-in timeout, so a stalled
// connection (a flaky proxy, a socket that never resolves or rejects) used
// to leave a navigation hanging indefinitely — the exact "webapp is stuck at
// loading" symptom, since nothing here would ever fall back to the cached
// page or the offline screen. Racing a timer forces a decision either way.
//
// 10s → 20s (2026-07-15, real bug): several personalized pages (messages,
// an open thread) chain more than one server-side timeout of their own —
// auth + a data fetch, sometimes + a second best-effort fetch — each
// individually bounded but not bounded as a TOTAL, so their combined worst
// case comfortably exceeded 10s even though each page has its own graceful
// "this is taking longer than usual, Retry" state built for exactly that.
// At 10s this timer routinely won the race, replacing that page's own
// retry UI with the SW's dead-end offline page instead — for a user who
// was online the entire time. 20s gives every page's own timeout budget
// room to actually resolve (and show its own Retry state) before this
// outer one ever has to step in.
SWX.networkFirst = async function networkFirst(request, { cacheName, preload, offlineFallback, timeoutMs = 20000 }) {
  try {
    const res = await Promise.race([
      (async () => (preload && (await preload)) || (await fetch(request)))(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("navigation timed out")), timeoutMs)),
    ]);
    if (!res) throw new Error("no response");
    if (cacheName && res.ok) await SWX.safePut(cacheName, request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
};
