# Startup Lifecycle Audit — Frenz (2026-07-12)

Production-grade trace of everything that runs from "user opens the app" to
"first screen interactive", with failure-mode analysis per step. Written
BEFORE the fixes in this round were applied; the **Fixes applied** column
notes what changed as a result. Companion to `docs/FRENZ_CORE.md`'s loading
architecture section.

## Startup flow diagram (full document load, signed in)

```
Browser request ─▶ [1] Middleware (Edge)
                     ├─ /api/v1|/api/me → CORS shortcut, no auth
                     ├─ prefetch header → pass-through, no auth
                     ├─ RSC soft-nav (non-protected) → pass-through, no auth
                     ├─ no auth cookie → pass-through (or /login redirect for protected)
                     └─ auth cookie → supabase.auth.getUser()  ⚠ was UNBOUNDED
                                       └─ admin check (only /admin)
                   ─▶ [2] HTML starts streaming
                     ├─ BootSplash: inline theme-resolver JS → inline CSS → splash div
                     │   → inline hide-script (sessionStorage "frenz-booted" gate,
                     │     frenz_just_signed_in cookie override, 6s failsafe hide)
                     ├─ next/font (self-hosted, swap) — never blocks paint
                     └─ preload /brand/frenz-logo.png
                   ─▶ [3] RSC render of the routed page (streams behind loading.tsx)
                     ├─ (app)/layout.tsx — synchronous BY DESIGN (no fetch)
                     └─ page.tsx — awaits createClient() → auth.getUser() ⚠ was
                        UNBOUNDED, then data queries (already withTimeout(8s))
                   ─▶ [4] Hydration + client boot
                     ├─ ThemeProvider (next-themes, localStorage) — sync
                     ├─ RegisterServiceWorker:
                     │   ├─ register /sw.js (updateViaCache:none) + update()
                     │   ├─ SKIP_WAITING promotion → ONE controllerchange reload
                     │   │   (guarded: only if a controller already existed)
                     │   └─ build-stamp check (4s later; visibility/focus gated
                     │       to ≥60s-away; sessionStorage loop guard)
                     ├─ App-shell trackers (all fire-and-forget, none block paint):
                     │   PresenceTracker (WS), AutoAwayTracker, InboxRealtimeTracker
                     │   (WS + loadInbox fetch), NotificationLiveToast (WS),
                     │   OfflineQueueSync (IndexedDB replay), DeviceCheck (1 fetch,
                     │   sessionStorage-gated), useEntitlements (/api/me, cached)
                     └─ MobileNav route prefetch (400ms delay, skipped on 2G)
                   ─▶ [5] Interactive
```

Client-side (SPA) navigation skips [1]-[2] entirely (Router Cache, staleTimes
6h) and only re-runs [3] on cache miss — that's the loading.tsx skeleton path.
bfcache restore (iOS back-gesture) skips EVERYTHING and fires only
`pageshow(persisted)` — handled app-wide in features/data/cache.ts and
bespoke in conversation-room.tsx (both added 2026-07-12).

## Step-by-step analysis

| # | Step | Depends on | Blocks render? | Can fail? | Infinite-loading risk | Guaranteed exit? |
|---|---|---|---|---|---|---|
| 1 | Middleware session refresh | Supabase auth endpoint | YES — whole document | network hang, Supabase outage | **HIGH (was): `auth.getUser()` had NO timeout — a stalled socket held the entire document, nothing ever painted** | **NO (was) → fixed: 5s race, pass-through on timeout** |
| 2 | BootSplash | inline only | intentionally paints | storage blocked (caught) | none — self-removing + 6s failsafe `setTimeout(hide, 6000)` | YES |
| 3 | Page RSC render | Supabase auth + data | YES — behind loading.tsx | same as 1 | **HIGH (was): page-level `auth.getUser()` unbounded (data queries were already time-boxed at 8s, the AUTH step wasn't) — loading.tsx skeleton forever** | **NO (was) → fixed on the messages surfaces: 6s box → honest Retry UI, never a false /login redirect** |
| 4a | SW register/update | /sw.js reachable | no | eval error (regression-tested since the SWX bug) | reload loops guarded (one controllerchange reload, per-build sessionStorage stamp) | YES |
| 4b | SW fetch interception | — | navigations only | stalled network | none — networkFirst races a 10s timer → cached copy → offline page (which self-reloads on `online`) | YES |
| 4c | Realtime channels (presence/inbox/thread/typing) | WS | no — UI renders from cache/seed first | CHANNEL_ERROR/TIMED_OUT | none — bounded first-attempt retry (thread), resync on visible/online/pageshow; typing state is cosmetic | YES |
| 4d | IndexedDB queues | browser storage | no | quota/private-mode (caught) | none — event-driven, never awaited by UI | YES |
| 4e | loadInbox/useQuery caches | /api/* | no — cached-first | fetch reject (caught) | none — errors keep last-good cache; revalidation on visible/online/pageshow | YES |

## Race conditions & deadlocks found

- **Middleware auth vs. document paint (the root cause)** — every full
  document load with an auth cookie serialized behind one un-time-boxed
  network call to Supabase's auth endpoint. On a flaky connection (mobile,
  hotel wifi, waking laptop) a socket that neither resolves nor rejects held
  the tab on a blank/loader state indefinitely. Same class of bug as the SW
  navigation stall fixed earlier (that one had its 10s race added; this one
  had nothing). **Fix: race with a 5s timer; on timeout the request passes
  through un-refreshed — every page still runs its own auth guard, and the
  next successful request refreshes the session cookie.** This also means an
  outright Supabase auth outage degrades to "app works, session refresh
  deferred" instead of "site down".
- **Page-level auth vs. loading.tsx** — the messages list/pane/thread pages
  time-boxed their DATA queries (8s → Retry UI) but not the `auth.getUser()`
  call before them. **Fix: same 6s time-box; a timeout renders the existing
  "taking longer than usual → Retry" state. Deliberately NOT a /login
  redirect — a slow network must never look like "signed out".**
- SW SKIP_WAITING → controllerchange reload right after a deploy: guarded to
  fire at most once and only when a previous controller existed; the
  build-stamp reload is stamped per-build in sessionStorage. No loop found.
- BrandSplash × Router Cache (fixed this round, see brand-splash.tsx): the
  first-ever /home tree stays in the client Router Cache for hours, so the
  splash REMOUNTED on every SPA return to Home on a new device. Client-side
  cookie recheck in the initial state kills it.
- Supabase Realtime socket exhaustion (fixed 2026-07-12, round 39): client
  is a singleton; every channel teardown must use `removeChannel` (all 8 call
  sites audited then; use-typing.ts re-verified this round).
- Token refresh across tabs: @supabase/ssr stores the session in cookies
  (shared), refresh is serialized per client; no cross-tab rotation race
  observed in delivery logs or repro attempts.

## Bottlenecks (measured against a local prod build)

1. Middleware `getUser()` on cookie-bearing document loads — one full RTT to
   Supabase auth before ANY byte streams. Mitigations already in place and
   kept: prefetch/RSC/no-cookie shortcuts skip it entirely; it only rides
   full document loads.
2. Page RSC data (messages list/thread) — already time-boxed (8s) and seeded
   into client caches; loading.tsx skeletons paint instantly.
3. SW cold-start on navigation — mitigated by navigation preload (see
   strategies.js networkFirst `preload`).

## What was NOT changed (checked, already sound)

- BootSplash exit paths (self-removing, 6s failsafe, storage-blocked catch).
- SW navigation strategy (10s race + cache + self-recovering offline page).
- Thread realtime retry/resync/catch-up (bounded, tested in earlier rounds).
- Offline message/action queues (event-driven, never block UI).
- loading.tsx coverage: every (app) route has a skeleton; none embed a
  colored/brand loader (the colored logo is cold-start/login only, per the
  owner's loader rule — BrandLoader is deliberately colorless).

## Follow-ups (documented, not silently skipped)

- The same 6s auth time-box should roll out to the remaining server pages
  (/home, /friends, /notifications, profile) — they degrade less severely
  (most render public shells), so the messages surfaces shipped first.
- `push_delivery_log` shows sends to non-admin users succeeding (201) while
  those devices show nothing — device-side stale service worker; heals via
  the register-sw update path on next open. Re-check the log after this
  deploy has been live a day.
