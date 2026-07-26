/* Frenz service worker v12 — entry point only. Each concern lives in its own
 * module under /sw/, loaded via importScripts() (classic-worker-compatible
 * across every browser this app targets, incl. Safari, which doesn't fully
 * support `{ type: "module" }` service workers) and wired together through
 * the shared `self.SWX` namespace:
 *
 * IMPORTANT: the browser's SW update check byte-diffs THIS file (the one
 * passed to `.register()`) — it does NOT separately diff the /sw/*.js files
 * pulled in via importScripts() below. Editing only a submodule (e.g.
 * strategies.js) without touching this file's own bytes means some browsers
 * may never notice a real update happened. Whenever you change any /sw/*.js
 * file, bump BOTH the version number in this comment AND SWX.VERSION in
 * config.js, so this entry file's bytes always change too.
 *
 *   config.js          cache names, versioning, limits, allowlists
 *   log.js              dev-only diagnostics
 *   cache-utils.js       trim / quota-safe write / cacheable-response checks
 *   strategies.js        cache-first / stale-while-revalidate / network-first
 *   lifecycle.js         install / activate / SKIP_WAITING promotion
 *   routes.js            the fetch router — which strategy for which request
 *   push.js              Web Push receive + notification click
 *   background-sync.js   offline-queue replay via the Background Sync API
 *
 * See docs/ARCHITECTURE.md-style module boundaries applied to the SW: each
 * file above only reads what an earlier one exported onto SWX, never the
 * reverse — config/log/cache-utils have no dependencies, strategies depends
 * on cache-utils, routes depends on strategies, lifecycle/push/background-
 * sync are leaves.
 */
importScripts(
  "/sw/config.js",
  "/sw/log.js",
  "/sw/cache-utils.js",
  "/sw/strategies.js",
  "/sw/lifecycle.js",
  "/sw/routes.js",
  "/sw/push.js",
  "/sw/background-sync.js",
);

/*
  ── Monetag verification + Multitag push (owner, 2026-07-26) ──────────────────
  Monetag's "file" ownership check wants ITS sw.js served at /sw.js — but that
  path is THIS file, the PWA service worker (offline, push, install). Overwriting
  it would destroy the installed-app experience, so Monetag's snippet is MERGED
  here instead, which is exactly what Monetag documents for sites that already run
  a service worker. The verification strings below appear verbatim, so Monetag's
  crawler check on /sw.js passes; the site id is public (it ships in this file
  either way), not a secret.

  GUARDED on purpose: importScripts() is synchronous and THROWS if the remote
  script can't be fetched — an un-guarded call would abort the ENTIRE service
  worker on any Monetag/CDN hiccup, taking offline mode + our own Web Push down
  with it. The try/catch keeps a Monetag outage from ever breaking the Frenz PWA.
*/
try {
  // Reproduced verbatim from Monetag's downloaded sw.js so their crawler's
  // content check matches exactly (single quotes, quoted keys included).
  self.options = {
    "domain": "5gvci.com",
    "zoneId": 11391266
  };
  self.lary = "";
  importScripts('https://5gvci.com/act/files/service-worker.min.js?r=sw');
} catch (e) {
  /* Monetag SW unavailable — never let a third-party outage break the PWA. */
}
