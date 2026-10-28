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
/*
  In-flight warm-ups (2026-10-28, owner: "fix the white screen on the PWA"). warmAppShellCss below starts the app's
  stylesheet download the moment /launch.html opens; when the app page then asks for the same URL, it waits on that
  download instead of starting a second one. URL -> promise, removed when it settles.
*/
const WARMING = new Map();

SWX.cacheFirst = async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  // `canServe`, not a bare truthiness check — a cached OPAQUE entry handed to a
  // non-`no-cors` request is a network error, not a cache hit (cache-utils.js).
  if (SWX.canServe(hit, request)) return hit;
  const warming = WARMING.get(request.url);
  if (warming) {
    await warming.catch(() => {});
    const warmed = await cache.match(request);
    if (SWX.canServe(warmed, request)) return warmed;
  }
  const res = await fetch(request);
  if (SWX.isCacheable(res) && !looksLikeCaptivePortalResponse(res)) {
    await SWX.safePut(cacheName, request, res.clone());
  } else if (looksLikeCaptivePortalResponse(res)) {
    SWX.log("skipped caching a static asset that responded with HTML — likely a captive portal", request.url);
  }
  return res;
};

/*
  ═══════════════════════════════════════════════════════════════════════════
   🔴 THE WHITE SCREEN BETWEEN /launch.html AND THE APP (owner, 2026-10-28)
  ═══════════════════════════════════════════════════════════════════════════

  A document paints NOTHING — the #frenz-boot loader included — until its render-blocking stylesheets have loaded.
  /launch.html's loader dies the moment /downloads commits, so the screen is blank for as long as the app's CSS takes
  over the network. It is cached cache-first here, but every deploy ships it under a new URL, so the first launch
  after each deploy downloaded ~50 kB of CSS on a blank screen.

  So /launch.html posts "frenz-warm-app-shell" as it opens, in parallel with its navigation: this reads a static page
  of the same (app) group — /history, CDN-cached, the same stylesheets as /downloads — revalidated so it names THIS
  deploy's files, and downloads any stylesheet not cached yet. By the time /downloads asks for it (its server render
  takes longer than this), it is cached or already in flight (cacheFirst above waits on it). Already cached = nothing
  but one small revalidation. Runs in the worker, so it survives /launch.html going away. Never throws.
*/
const APP_SHELL_SOURCE = "/history";
SWX.warmAppShellCss = async function warmAppShellCss() {
  try {
    const page = await fetch(new Request(APP_SHELL_SOURCE, { cache: "no-cache", credentials: "omit", headers: { Accept: "text/html" } }));
    if (!page.ok) return;
    const html = await page.text();
    const hrefs = [...new Set([...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="(\/_next\/static\/css\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))].slice(0, 8);
    const cache = await caches.open(SWX.STATIC_CACHE);
    await Promise.allSettled(
      hrefs.map(async (href) => {
        const url = new URL(href, self.location.origin).href;
        if (WARMING.has(url) || (await cache.match(url))) return;
        const job = (async () => {
          const res = await fetch(url, { credentials: "same-origin" });
          if (SWX.isCacheable(res) && !looksLikeCaptivePortalResponse(res)) await SWX.safePut(SWX.STATIC_CACHE, new Request(url), res.clone());
        })();
        WARMING.set(url, job);
        try {
          await job;
        } finally {
          WARMING.delete(url);
        }
      }),
    );
  } catch {
    // a warm-up is only ever a head start
  }
};

// A history thumbnail the page already kept (config.js HISTORY_THUMB_CACHE).
// Null on a miss — or on any Cache Storage error — so the caller's normal
// strategy runs exactly as before.
SWX.fromHistoryThumbs = async function fromHistoryThumbs(request) {
  try {
    const hit = await (await caches.open(SWX.HISTORY_THUMB_CACHE)).match(request);
    return SWX.canServe(hit, request) ? hit : null;
  } catch {
    return null;
  }
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

/*
  🔴 A HUNG PROMISE IS NOT AN ANSWER (owner, 2026-10-23: "when I leave the PWA for a few minutes to hours
  and come back it gets stuck at the brand loader"). After iOS keeps an app in the background, the
  connection it held can be dead while the phone still reports itself online — a request on it neither
  answers nor fails. Navigation PRELOAD hangs the same way. So the preload gets PRELOAD_WAIT_MS, then
  the document is fetched directly; and networkFirst below retries on a fresh connection and has a hard
  limit. Every wait resolves; none can hold the loader forever.
*/
const PRELOAD_WAIT_MS = 3000;
function within(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

async function fetchDocument(request, preload, preloadWaitMs = PRELOAD_WAIT_MS) {
  let res = null;
  try {
    res = (preload && (await within(Promise.resolve(preload), preloadWaitMs))) || (await fetch(request));
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

/*
  ── 🔴 THE SAME STALE-CACHE HOLE, ARRIVING BY CLIENT-SIDE NAVIGATION (v23) ──

  Owner, 2026-09-13: tapping "Frenz AI" (a <Link>) on the Character Replace
  page showed "A new version is ready", and kept showing it after going back,
  coming again, and relaunching the app.

  A <Link> does not navigate; it fetch()es the destination's RSC payload
  (`?_rsc=…`, header `RSC: 1`). That request is NOT `mode: "navigate"`, so
  the router above let it pass "straight to network" — where the phone's HTTP
  cache answered with the payload Cloudflare had stamped `max-age=7200` two
  hours earlier, from BEFORE the deploy. Its client-chunk references no longer
  existed, the chunk load threw, and the error boundary drew that screen. The
  document itself was stale for the same two hours, which is why relaunching
  did not help either (that half is v21's Date check, above).

  So an RSC fetch is re-issued with `cache: "no-cache"`: a conditional request
  that costs one ETag round-trip when nothing changed — which is exactly what
  the origin's own `max-age=0, must-revalidate` asked for before Cloudflare
  rewrote it — and returns the live payload after a deploy. The original
  request's headers (RSC, Next-Router-State-Tree, Next-Url) ride along, since
  the copy is made FROM the request. A rejection falls back to the plain
  fetch so an offline member sees Next's own recovery, not a blank.
*/
SWX.fetchRevalidated = async function fetchRevalidated(request) {
  try {
    return await fetch(new Request(request, { cache: "no-cache" }));
  } catch {
    return fetch(request);
  }
};

/** networkFirst's limits for a NAVIGATION: a fresh retry after this long, and give up (the offline page, which retries itself) after this. */
const NAV_RETRY_AFTER_MS = 6000;
const NAV_HARD_LIMIT_MS = 25000;
const HUNG = { hung: true };

SWX.networkFirst = async function networkFirst(request, { cacheName, preload, offlineFallback, timeoutMs = 20000, retryAfterMs = NAV_RETRY_AFTER_MS, hardLimitMs = NAV_HARD_LIMIT_MS, preloadWaitMs = PRELOAD_WAIT_MS }) {
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
  const fromNetwork = fetchDocument(request, preload, preloadWaitMs);
  /* Nothing may observe this as an unhandled rejection while we wait on the race. */
  fromNetwork.catch(() => {});

  try {
    let res;
    if (request.mode === "navigate") {
      /*
        A navigation (the 2026-10-23 resume hang): the first request, OR a fresh one started after
        retryAfterMs on a new connection — whichever answers first — and never longer than hardLimitMs.
        A genuine failure of the first still falls back at once (fetchDocument already retried it).
      */
      let hardTimer;
      let retryTimer;
      const retry = new Promise((resolve) => {
        retryTimer = setTimeout(() => {
          if (self.navigator?.onLine === false) return;
          // a fresh request; it only ever WINS — its failure leaves the first request in charge
          fetch(revalidatingRequest(request)).then(resolve, () => {});
        }, retryAfterMs);
      });
      const hard = new Promise((resolve) => {
        hardTimer = setTimeout(() => resolve(HUNG), hardLimitMs);
      });
      try {
        res = await Promise.race([fromNetwork, retry, hard]);
      } finally {
        clearTimeout(hardTimer);
        clearTimeout(retryTimer);
      }
      // still nothing: not a stale document (it would lose its styles) — the offline page, which retries itself
      if (res === HUNG) return offlineFallback();
    } else try {
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
