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
  // `canServe`, not a bare truthiness check — a cached OPAQUE entry handed to a
  // non-`no-cors` request is a network error, not a cache hit (cache-utils.js).
  if (SWX.canServe(hit, request)) return hit;
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
  // A stored entry the browser would REFUSE for this request is not a hit — see
  // `canServe` in cache-utils.js for the opaque-response network error this
  // closes. Falling through to the network also self-heals the cache, because
  // the fresh response overwrites the unusable entry below.
  const stored = await cache.match(request);
  const hit = SWX.canServe(stored, request) ? stored : null;
  const network = fetch(request)
    .then(async (res) => {
      if (SWX.isCacheable(res)) await SWX.safePut(cacheName, request, res.clone());
      return res;
    })
    /*
      🔴 RE-THROW when there is nothing to fall back to. This used to be
      `.catch(() => hit)`, so a failed fetch with no cached copy resolved the
      whole strategy to `undefined` — and `respondWith(undefined)` is itself a
      network error ("the promise was resolved with an object that is not a
      Response"), reported to the caller as the same opaque-looking
      "Failed to fetch" / "Load failed" as a real outage, with the SW's own
      bug standing in for the network's. Throwing hands the request back with
      its ACTUAL failure, exactly as if the worker were not installed.
    */
    .catch((err) => {
      if (hit) return hit;
      throw err;
    });
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
/*
  ═══════════════════════════════════════════════════════════════════════════
   🔴 "NETWORK-FIRST" WAS HTTP-CACHE-FIRST FOR TWO HOURS (owner, 2026-09-13)
  ═══════════════════════════════════════════════════════════════════════════
  Same screenshot as 2026-09-07 — the landing as raw serif text, bullets and
  an unscaled image — six days after the timeout fallback below was removed.
  "It shows this colourless almost blank page when I enter the browser on
  cold start."

  Measured on production:
    · Vercel sends the document as `public, max-age=0, must-revalidate`;
    · Cloudflare rewrites that to `public, max-age=7200` (the same rewrite
      that once held an admin ad switch for two hours);
    · so the PHONE's HTTP cache keeps a document for two hours, and every
      `<link>` in it names `/_next/static/…?dpl=<that deploy>`;
    · a deploy later, those hashes are gone: an unknown hash answers 404 and
      the `dpl` pin is not honoured. The old document paints with no CSS.

  Both `event.preloadResponse` and a plain `fetch(request)` are satisfied from
  that HTTP cache while the 7200 s hold, so this strategy never asked the
  network at all in the case that mattered. It only LOOKED network-first.

  The tell: a response that came from the HTTP cache carries the `Date` the
  server stamped when it was first fetched. A document more than a few
  minutes old cannot be "the network's answer" to a request made just now,
  so it is revalidated with `cache: "no-cache"` — a conditional request that
  costs one ETag round-trip when nothing changed and returns the live
  document when a deploy did. Preload keeps its head start in the fresh case,
  which is every case except the two hours after a deploy.

  A second, smaller path to the same screenshot: on a cold start iOS often
  REJECTS the very first request while the radio wakes, and a rejection went
  straight to the cached document (whose assets may not be cached at all).
  One retry, when the browser says it is online, before falling back.

  The Cloudflare rewrite itself is not fixable from this repository:
  Caching → Configuration → Browser Cache TTL → "Respect Existing Headers".
  Until that is set, a browser WITHOUT this worker still holds a document
  for two hours; with it, every navigation this worker sees is honest.
*/
const STALE_DOCUMENT_MS = 5 * 60 * 1000;

function documentLooksStale(res) {
  if (!res || !res.ok) return false;
  const stamped = Date.parse(res.headers.get("date") || "");
  return Number.isFinite(stamped) && Date.now() - stamped > STALE_DOCUMENT_MS;
}

// A revalidating copy of a navigation request. Constructed from the URL rather
// than the Request so the browser accepts it: a "navigate"-mode Request cannot
// be re-issued from a worker, but a same-origin GET for the same document can.
function revalidatingRequest(request) {
  return new Request(request.url, {
    method: "GET",
    cache: "no-cache",
    credentials: "same-origin",
    redirect: "follow",
    headers: { Accept: request.headers.get("accept") || "text/html,application/xhtml+xml" },
  });
}

async function fetchDocument(request, preload) {
  let res = null;
  try {
    res = (preload && (await preload)) || (await fetch(request));
  } catch (err) {
    // The radio-wake rejection: one retry while the browser still says online.
    if (request.mode === "navigate" && self.navigator?.onLine !== false) {
      await new Promise((r) => setTimeout(r, 400));
      res = await fetch(revalidatingRequest(request));
    } else {
      throw err;
    }
  }
  if (request.mode === "navigate" && documentLooksStale(res)) {
    try {
      const fresh = await fetch(revalidatingRequest(request));
      if (fresh && fresh.ok) res = fresh;
    } catch {
      // Revalidation failed outright: the copy we have is still a document.
    }
  }
  return res;
}

SWX.networkFirst = async function networkFirst(request, { cacheName, preload, offlineFallback, timeoutMs = 20000 }) {
  /*
    ═══════════════════════════════════════════════════════════════════════════
     🔴 A SLOW NETWORK IS NOT AN OFFLINE NETWORK
    ═══════════════════════════════════════════════════════════════════════════

    Owner, 2026-09-07, with a screenshot of the landing rendered with NO CSS:
    "when i open the website on broswer it first shows this like is a cache or
    device cache and untill i refresh thats when it then shows the main page."

    That is this line's doing. The race below used to reject on the timeout and
    fall into the `catch`, which serves `caches.match(request)` — a document
    cached on some EARLIER visit, and therefore from an earlier DEPLOY. Its
    `<link>` tags name hashed asset URLs (`/_next/static/...?dpl=…`) that no
    longer exist, so every stylesheet 404s and the page paints as raw text and
    an unscaled image. Refreshing works because the connection is warm the
    second time and the network wins the race.

    20 seconds is nowhere near unreachable on mobile data, which is where this
    was reported from.

    So a TIMEOUT no longer falls back to the cache. It goes on waiting for the
    network, and the browser shows its own loading state — slow is honest, a
    stale document dressed as the live site is not. Only a genuine network
    FAILURE (fetch rejects: offline, DNS, connection refused) falls back, which
    is what the cache is actually for.

    The timeout still exists, and still matters: it is what stops a hung request
    from holding the page forever when we ARE offline and the failure has not
    surfaced as a rejection yet.
  */
  const fromNetwork = fetchDocument(request, preload);
  /* Nothing may observe this as an unhandled rejection while we wait on the race. */
  fromNetwork.catch(() => {});

  try {
    let res;
    try {
      res = await Promise.race([
        fromNetwork,
        new Promise((_, reject) => setTimeout(() => reject(new Error("navigation timed out")), timeoutMs)),
      ]);
    } catch (err) {
      // Timed out rather than failed, and we appear to be online: keep waiting
      // for the real response instead of serving a document from another
      // deployment. If the network then genuinely fails, the outer catch
      // handles it exactly as before.
      if (err && err.message === "navigation timed out" && self.navigator?.onLine !== false) {
        res = await fromNetwork;
      } else {
        throw err;
      }
    }
    if (!res) throw new Error("no response");
    /*
      🔴 The cache write must NOT be awaited (2026-08-11).

      `cache.put()` reads the response body to completion before it resolves.
      Awaiting it here meant the page got nothing until the ENTIRE document had
      arrived — which was harmless while Next buffered every page and sent it in
      one piece, and is actively wrong now that the entry routes STREAM their
      shell first (18a4b05). A streamed page whose data takes two seconds would
      have been held for the full two seconds by this line, turning the
      white-screen fix into a white screen with extra steps.

      Fire-and-forget on the clone instead: the response is returned the instant
      its headers arrive, and the clone fills the cache in the background at its
      own pace. `safePut` already swallows its own failures.
    */
    if (cacheName && res.ok) void SWX.safePut(cacheName, request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
};
