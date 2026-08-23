/* Frenz service worker — shared configuration. Single source of truth for
 * cache names/versioning/limits, loaded first via importScripts() so every
 * other module can read it. Bump VERSION whenever a cache's CONTENTS or
 * SHAPE changes incompatibly — activate() (lifecycle.js) deletes every cache
 * not in KEEP, so an old and new version's data can never coexist past one
 * activation. */
var SWX = (self.SWX = self.SWX || {});

// v15 (2026-08-23): `/launch.html` gained the twelve `apple-touch-startup-image`
// links that stop iOS painting its own plain-white splash before the loader
// (owner: "it still shows white on cold load entry in the pwa"). The document is
// PRECACHED into PAGE_CACHE and served cache-first, so without a bump every
// installed PWA would keep booting the old, tag-less copy from a v14 bucket and
// the fix would reach nobody who already has the app — precisely the people
// reporting it. The CONTENTS of a precached document changed, so the bucket
// must be new.
//
// v14 (2026-08-11): the cold-entry redirect for the stale `/home` start_url
// (routes.js). The cache contents are unchanged, but the bump is what makes an
// installed worker update at all — a routing change that never activates is a
// change that never shipped.
//
// v13 (2026-08-11): PRECACHE_URLS gained /launch + the splash logo — the cache
// CONTENTS changed, so the bucket must be new or an installed client keeps a v12
// cache that has neither.
SWX.VERSION = "v15";
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
// 🔴 The splash logo is precached deliberately (2026-08-11) — the cold-entry
// loader inlines it as a data URI, but the boot splash and the app both use the
// same file, so a warm copy pays for itself immediately.
//
// The cold-entry document itself is in PRECACHE_DOCUMENTS below. It is the ONE
// screen that has to paint before the
// origin answers — on the live site the first byte of any real app route is
// 0.66–2.3s away. Precached, the cold-entry loader is served from disk in ~0ms
// on every launch after the first, so the branded screen is up instantly and the
// real page loads behind it.
//
// It is SAFE to precache in this shared, URL-keyed bucket for the one reason
// that matters: `/launch` is `force-static` and contains NO user data. That is
// the same test `/` had to pass for PAGE_CACHE_ALLOWLIST_EXACT below, and it is
// the reason no personalized route may ever join this list.
SWX.PRECACHE_URLS = [
  "/brand/frenz-logo-splash.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

// 🔴 DOCUMENTS precache separately, into PAGE_CACHE.
//
// The list above is written into IMAGE_CACHE because that is where routes.js
// looks images up. `/launch` is a NAVIGATION and routes.js reads navigations
// from PAGE_CACHE — precaching it alongside the images would have put it in a
// cache nothing ever reads for it, which is precisely the no-op the note above
// warns about. Two lists, each named for the cache it lands in, so the pairing
// cannot silently come apart again.
SWX.PRECACHE_DOCUMENTS = ["/launch.html"];

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
// "/" IS allowlisted as of 2026-07-17. It previously was not, for a reason that
// no longer holds: app/page.tsx used to call cookies()/getUser() and redirect a
// SIGNED-IN visitor to /home, so "/" wasn't purely public by construction and
// could in principle put personalized HTML in this shared, URL-keyed bucket.
//
// That redirect now runs in middleware.ts, and app/page.tsx touches NO dynamic
// API at all — "/" is statically prerendered and byte-identical for every
// visitor (see docs/FEATURE_21_LANDING.md §4 and the comment in app/page.tsx).
// A signed-in visitor never reaches it; the edge redirects them first. So the
// hazard this exclusion guarded against is now structurally impossible, and the
// installed PWA gets the marketing page from cache the moment the network is
// slow or flaky instead of hanging on networkFirst's 10s timeout and dropping
// to the offline page — the owner's "the landing page doesn't refresh like a
// native app on the webapp".
//
// If "/" ever regains a server-side auth read, this MUST be reverted with it.
// `/launch` joins for the same reason: static, no user data, and it is the
// screen a cold launch must never wait on the network for.
SWX.PAGE_CACHE_ALLOWLIST_EXACT = ["/", "/launch.html"];

// Dev-only diagnostics. sw.js is a static file (no bundler env-var inlining
// like the rest of the app gets), so this checks the actual hostname at
// runtime instead of process.env.
SWX.DEBUG = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";
