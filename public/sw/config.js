/* Frenz service worker — shared configuration. Single source of truth for
 * cache names/versioning/limits, loaded first via importScripts() so every
 * other module can read it. Bump VERSION whenever a cache's CONTENTS or
 * SHAPE changes incompatibly — activate() (lifecycle.js) deletes every cache
 * not in KEEP, so an old and new version's data can never coexist past one
 * activation. */
var SWX = (self.SWX = self.SWX || {});

SWX.VERSION = "v10";
SWX.STATIC_CACHE = `frenz-static-${SWX.VERSION}`;
SWX.IMAGE_CACHE = `frenz-img-${SWX.VERSION}`;
SWX.PAGE_CACHE = `frenz-pages-${SWX.VERSION}`;
SWX.API_CACHE = `frenz-api-${SWX.VERSION}`;
SWX.KEEP = [SWX.STATIC_CACHE, SWX.IMAGE_CACHE, SWX.PAGE_CACHE, SWX.API_CACHE];

// Every runtime cache that can grow unboundedly gets trimmed (oldest-
// inserted-first) after each write. Fixes the PAGE_CACHE gap found in the
// PWA audit — only IMAGE_CACHE was ever capped before this.
SWX.LIMITS = {
  [SWX.IMAGE_CACHE]: 80,
  [SWX.PAGE_CACHE]: 60,
  [SWX.API_CACHE]: 40,
};

// Small, build-STABLE public assets only. Anything under /_next/static/ has
// a content hash in its filename that only exists after `next build`, so it
// can't be listed here by hand — those warm into STATIC_CACHE on first use
// via the cache-first route instead (see routes.js). A true precache
// manifest (à la Workbox) would need a postbuild step reading Next's build
// manifest; deliberately not added yet (adds real build-pipeline coupling
// for a marginal win over warm-on-first-visit) — this list covers what's
// safely precacheable without one.
//
// Precached into IMAGE_CACHE (not STATIC_CACHE) — routes.js's fetch router
// matches these by extension into the image strategy at runtime, so
// precaching them anywhere else would mean the warm copy is never actually
// read back. `/manifest.webmanifest` is deliberately NOT precached: it isn't
// a hashed/immutable asset (app/manifest.ts can change independent of a SW
// VERSION bump) and routes.js intentionally sends it straight to network for
// that reason — precaching it would've been dead weight either way.
SWX.PRECACHE_URLS = ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

// Explicit allowlist for SW-level API response caching (stale-while-
// revalidate, routes.js). Intentionally EMPTY today: every current /api/*
// route is either personalized/auth-scoped, or already has its own correct
// HTTP-cache story via lib/api/edge-cache.ts (s-maxage/stale-while-
// revalidate headers the browser's own HTTP cache already honors without
// any help from the service worker). The Cache API storage here is shared
// across the WHOLE origin, not partitioned per signed-in user — caching a
// response by URL alone without confirming it's genuinely public and
// unauthenticated risks serving one account's data to the next person on a
// shared/public device. Add a pathname here only once a route is confirmed
// anonymous-safe by construction.
SWX.API_CACHE_ALLOWLIST = [];

// Explicit allowlist for PAGE_CACHE (navigation HTML), same reasoning and
// same "empty/allowlist, never blocklist" discipline as API_CACHE_ALLOWLIST
// above — found missing 2026-07-12 while chasing a "messages page stuck
// loading, webapp-only" report. routes.js used to page-cache EVERY
// same-origin navigation indiscriminately, including `(app)`'s personalized
// pages (/messages, /home, /account, ...). On a slow/flaky connection —
// exactly the profile a mobile installed PWA sees far more than a desktop
// browser tab — networkFirst's 10s timeout falls back to whatever's cached
// for that exact URL: a STALE snapshot of someone's own inbox/thread (best
// case) or, on a shared/public device with a second account signed in since,
// literally the wrong person's messages (worst case). Only genuinely public,
// unpersonalized marketing/static pages belong here.
// The [downloader] SEO pages (/tiktok-hd-downloader etc, config/seoPages.ts)
// are ALSO genuinely public/static, but they're single dynamic root
// segments with no shared prefix to match cheaply here — left out (safe:
// they simply don't get the cache-speed benefit, same as any other
// non-allowlisted URL) rather than guessing at path patterns.
SWX.PAGE_CACHE_ALLOWLIST_PREFIXES = ["/blog", "/contact", "/developers", "/dmca", "/privacy", "/terms", "/pricing"];
// "/" is deliberately NOT here even though it's the marketing landing page:
// app/page.tsx redirects a SIGNED-IN visitor straight to /home (personalized),
// so "/" isn't purely public by construction. A signed-out visitor's landing
// page not getting the cache-speed benefit is a fine trade for never risking
// this bucket seeing personalized HTML under any circumstance — the whole
// point of this allowlist. See the block comment above.
SWX.PAGE_CACHE_ALLOWLIST_EXACT = [];

// Dev-only diagnostics. sw.js is a static file (no bundler env-var inlining
// like the rest of the app gets), so this checks the actual hostname at
// runtime instead of process.env.
SWX.DEBUG = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
