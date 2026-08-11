/* The fetch router — decides which strategy (strategies.js) applies to
 * which request. This is the only place that inspects a request and picks a
 * cache; the strategies themselves stay resource-agnostic. */
var SWX = (self.SWX = self.SWX || {});

// #050816 matches globals.css's actual dark --background and the manifest's
// BootSplash rest-state exactly (see app/layout.tsx's viewport.themeColor
// comment) — this used to be a different near-black (#080b14) that matched
// nothing else in the app, the same class of small inconsistency already
// fixed once for the boot splash / theme-color meta.
SWX.OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Offline · Frenz</title><style>" +
  "html,body{height:100%;margin:0;background:#050816;color:#e5e7eb;" +
  "font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;" +
  "justify-content:center;text-align:center}" +
  "div{padding:2rem}h1{font-size:1.25rem;margin:.5rem 0}" +
  "p{color:#9ca3af;font-size:.9rem}" +
  "</style></head><body><div><h1>You’re offline</h1>" +
  "<p>Check your connection — Frenz will be right back.</p></div>" +
  // Auto-recover, two ways. (1) The `online` event — real for a genuine
  // disconnect. (2) A real bug found 2026-07-15: this page isn't only shown
  // for an actual dropped connection — `networkFirst`'s own 10s hard
  // timeout (strategies.js) serves this SAME fallback for a merely SLOW
  // response (a cold serverless function, a query near its own timeout)
  // while the device was online the entire time. `online` never fires in
  // that case — there was no disconnect to recover from — so the tab was
  // stuck on this dead-end screen indefinitely, reading exactly like the
  // "stuck on loading" / "PWA shows an old screen" reports. A periodic
  // retry re-enters the SW fetch handler for a fresh attempt regardless of
  // which case this was; a real outage just keeps failing fast and re-
  // showing this page until connectivity actually returns.
  '<script>addEventListener("online",()=>location.reload());' +
  "setInterval(()=>location.reload(),5000)</script>" +
  "</body></html>";

function offlineFallback() {
  return new Response(SWX.OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Media streams (reels, feed video, HLS playlists/segments, audio) must
  // never wait on service-worker logic — bail before any other work so the
  // browser's native pipeline (incl. range requests) handles them untouched.
  if (req.destination === "video" || req.destination === "audio") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (/\.(m3u8|ts|m4s|mp4|m4a|mp3|webm)$/i.test(url.pathname)) return;

  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/"));
  const isFont = /\.(woff2?|ttf|otf)$/i.test(url.pathname);
  const isImage = req.destination === "image" || /\.(avif|webp|png|jpe?g|gif|svg|ico)$/i.test(url.pathname);

  // Immutable, hashed assets — cache-first (they never change under the same URL).
  if (isStatic || isFont) {
    event.respondWith(SWX.cacheFirst(req, SWX.STATIC_CACHE));
    return;
  }

  // Images — stale-while-revalidate, capped (config.js LIMITS).
  if (isImage) {
    event.respondWith(SWX.staleWhileRevalidate(req, SWX.IMAGE_CACHE));
    return;
  }

  // Navigations — network-first, using preload when the browser already
  // started it. Only genuinely public/static pages (config.js's
  // PAGE_CACHE_ALLOWLIST_*) are written to PAGE_CACHE — that cache is one
  // shared bucket keyed by URL alone, not partitioned per signed-in user, so
  // caching a personalized page (e.g. /messages) risked a slow-network
  // timeout falling back to a STALE (or, on a shared device with a second
  // account since, wrong-user's) cached copy — same reasoning
  // API_CACHE_ALLOWLIST already applied to API responses, just missed here
  // originally. Every other page still gets the network-first + timeout +
  // offline-fallback behavior, just never reads/writes the page cache.
  /*
    🔴 THE COLD-ENTRY LOADER IS CACHE-FIRST, and it is the only navigation that
    is (2026-08-11).

    `/launch.html` is the PWA's start_url and the one screen whose entire job is
    to be on screen before the network answers. Under the network-first rule
    below it would still wait for a round-trip, and precaching it would buy
    nothing — which is the trap this branch exists to avoid.

    Cache-first is safe HERE and nowhere else for one reason: it is a hand-
    written static file with NO user data in it at all, so a shared, URL-keyed
    cache cannot leak one person's page to another. It is the same test "/" had
    to pass. Any personalized route taking this path would be the stale/wrong-
    user bug the allowlist below was written to prevent.

    It still revalidates in the background, so a deploy that changes the loader
    reaches the device on the next launch.
  */
  if (req.mode === "navigate" && url.origin === self.location.origin && url.pathname === "/launch.html") {
    event.respondWith(SWX.staleWhileRevalidate(req, SWX.PAGE_CACHE));
    return;
  }

  /*
    🔴 ALREADY-INSTALLED APPS STILL LAUNCH THE OLD start_url (2026-08-11).

    `start_url` moved to `/launch.html` in the manifest, but an installed PWA
    does not pick that up when the manifest changes: on Android the launcher
    holds the URL baked into the WebAPK at install time, and Chrome only
    refreshes it via a WebAPK update that can take a day or more. Every app
    installed before that change therefore still opens `/home` — and never
    reaches the loader at all. That is the "I no longer see the cold entry
    loader" report: the loader is fine, nothing was routing to it.

    So the worker forwards that entry itself. It costs NO network round-trip:
    the redirect is generated here and `/launch.html` is served from PAGE_CACHE
    by the branch above, so the loader paints immediately instead of after
    /home's time to first byte.

    ── The two guards, and why a loop here would be unrecoverable ────────────
    A redirect loop in a service worker survives a reload, so both guards are
    deliberately conservative and either one alone is sufficient:

     1. `req.referrer` must be EMPTY. A launcher tap, a bookmark and a typed
        URL have no referrer; `launch.html`'s own `location.replace()` back to
        `/home` (Full Bleed mode) carries one, so the return trip never
        re-enters this branch.
     2. An in-memory debounce. If a browser ever omitted the referrer on that
        return trip, this stops the second bounce rather than spinning. The
        worker being evicted resets it, which only means the guard is
        best-effort — the referrer check is the real one.

    Deliberately NOT redirected: `/downloads`, `/`, or any other route. Only the
    stale start_url is intercepted, so nothing a member navigates to normally
    can be diverted.
  */
  if (
    req.mode === "navigate" &&
    url.origin === self.location.origin &&
    url.pathname === "/home" &&
    !url.search &&
    !req.referrer &&
    Date.now() - (SWX.__lastBootRedirect || 0) > 10000
  ) {
    SWX.__lastBootRedirect = Date.now();
    // No `?next=`: launch.html reads the frenz_mode cookie itself and picks the
    // right home. Passing a destination from here would mean the worker and the
    // loader could disagree about the default mode — the 2026-08-09 bug.
    //
    // 🔴 ABSOLUTE url. `Response.redirect()` throws a TypeError on a relative
    // one, and a throw inside respondWith fails the navigation outright — the
    // app would not open at all.
    event.respondWith(Response.redirect(new URL("/launch.html", self.location.origin).href, 302));
    return;
  }

  if (req.mode === "navigate") {
    const sameOrigin = url.origin === self.location.origin;
    const cacheable =
      sameOrigin &&
      (SWX.PAGE_CACHE_ALLOWLIST_EXACT.includes(url.pathname) ||
        SWX.PAGE_CACHE_ALLOWLIST_PREFIXES.some((p) => url.pathname.startsWith(p)));
    event.respondWith(
      SWX.networkFirst(req, {
        cacheName: cacheable ? SWX.PAGE_CACHE : null,
        preload: event.preloadResponse,
        offlineFallback,
      }),
    );
    return;
  }

  // A narrow, explicit allowlist only — see config.js for why it starts empty.
  if (url.origin === self.location.origin && SWX.API_CACHE_ALLOWLIST.includes(url.pathname)) {
    event.respondWith(SWX.staleWhileRevalidate(req, SWX.API_CACHE));
    return;
  }

  // Everything else (API, realtime, etc.) — untouched, straight to network.
});
