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
  // Auto-recover: this page (served in place of a real navigation) can't
  // rely on the app's own `online` listeners since none of its JS ever
  // loaded — reload itself the moment connectivity returns instead of
  // leaving the user stuck staring at a stale offline screen.
  '<script>addEventListener("online",()=>location.reload())</script>' +
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
