/* Frenz service worker v18 — entry point only. Each concern lives in its own
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
  ── Monetag PUSH disabled — the app owns the push subscription (owner, 2026-07-27)
  Monetag's push service-worker (imported here previously) subscribes the browser
  to MONETAG's push server. A service-worker registration allows exactly ONE push
  subscription, so Monetag's subscribe() REPLACED the app's own VAPID subscription:
  the app's likes/comments/messages/broadcast pushes then landed on a stale
  endpoint and never arrived, while Monetag kept sending ad pushes independent of
  the in-app ad toggle (owner: "i turned off the ad but still get the push, and no
  interaction/message push comes"). The two cannot coexist on one SW — a hard
  web-platform limit — so the owner chose to keep the platform's OWN push and drop
  Monetag PUSH. Every OTHER Monetag format (Multitag, in-page push widget, vignette,
  popunder) is an in-page <script> tag emitted by MonetagScript and is unaffected.

  The `importScripts('https://5gvci.com/.../service-worker.min.js')` line that
  loaded Monetag's push code is intentionally REMOVED. The verification strings are
  kept as inert globals (they do nothing without the script) so Monetag's file-
  ownership crawler check on /sw.js still matches. To re-enable Monetag push, restore
  the guarded importScripts call below — but it WILL take the app's own push down again.
*/
self.options = { "domain": "5gvci.com", "zoneId": 11391266 };
self.lary = "";
// importScripts('https://5gvci.com/act/files/service-worker.min.js?r=sw'); // DISABLED — hijacks the app's push subscription (see above)
