# Site-wide request cost audit — 2026-10-05

Owner: *"check the reels, feed, message, profile, discovery, friends and other
pages and SEO pages if they run duplicate request and consume fast origin and
API request without being used and when being used … ads are not running now so
they shouldn't request any API."* Context from the owner's bill the same day:
**$30.49 in 16 days at ≤350 daily users** — Observability Events $6.64, Fast
Origin Transfer $5.32, Fluid Active CPU $5.07, Build CPU $4.93, Provisioned
Memory $2.80, ISR Writes $2.72, Vercel Agent $1.38, Function Invocations $1.21
(≈2M invocations ⇒ ~360 per daily user per day).

## Method

Production build (`next build` + `next start`, **both with
`VERCEL_GIT_COMMIT_SHA` fixed** — without it a local build stamps client and
server differently and every page reloads once, doubling every count). Headless
Chromium at 390×844, signed out and signed in, per page:
**idle** (15 s, no input) → **in use** (scroll three screens) → **hidden**
(another tab in front, 30 s). Every request to our origin that is not a hashed
static asset is counted; duplicates are keyed by METHOD + path + query names.
Rows whose stylesheets failed or that reloaded are flagged, never counted
silently. Probe: `scripts/_cost-audit.tmp.mjs` (local, gitignored).

38 pages × 2 audiences for the full survey; the before/after below is the same
10 pages measured with the same probe on each build.

## Result — same 10 pages, before → after

| | Signed out | Signed in |
|---|---|---|
| Server requests reaching the origin | **408 → 202 (−50%)** | **434 → 309 (−29%)** |
| Ad API calls (ads are off) | **85 → 0** | **86 → 0** |
| Full page renders nobody opened | **85 → 37** | 105 → 96 (see "owner decision") |
| Requests while the tab was hidden | 1 → 0 | 5 → 0 |

"Reaching the origin" excludes the three new 5-minute-bucket endpoints, which
the CDN answers after the first request in each bucket.

## What was found and fixed

1. **Ad APIs called with every network off** — ~7 private, uncacheable
   invocations per page view (`/api/ads?zones`, `?zone=global&all=1`,
   `/api/ads/exoclick` ×2–4, `/api/monetag`, `/api/ads/config`), every one
   answering null. Now one global inventory (`/api/ads/inventory`) computed by
   the SAME resolvers the real endpoints run (`lib/monetization/zone-resolution.ts`),
   CDN-cached; every ad fetcher consults it and skips what cannot fill. Unknown
   inventory ⇒ request as before (can save a request, never cost an impression).
   When an ad network is switched on it is live within five minutes.
2. **Ad config / Monetag / announcement were `private`** to dodge Cloudflare's
   two-hour TTL rewrite, so every page view was an origin hit for one global
   answer. Now `?b=<5-minute bucket>` + `s-maxage=300` (`lib/net/cdn-bucket.ts`):
   CDN-served, and no TTL rewrite can pin an old answer past one bucket. The
   announcement also re-fetched on EVERY client navigation; now once per document.
3. **Guests warmed member pages** — the bottom nav and the (hidden-on-phone)
   desktop sidebar prefetched `/home`, `/friends`, `/messages`, `/account`,
   `/studio/ai/history` for signed-out visitors. Guests now warm public tabs
   only; the member lists are unchanged.
4. **Guests paid a full render before being sent to /login** on `/downloads`,
   `/home`, `/friends/*`, `/notifications`, `/saved`, `/create/*`, `/welcome`.
   Now an edge 307 in middleware's no-cookie branch (`lib/auth/guest-login-paths.ts`,
   kept in step with the pages by a two-direction test).
5. **Members rendered `/downloads` on almost every page** — the header logo
   pointed at `/`, middleware 307s a member's `/`, and the followed redirect of
   the viewport prefetch was a plain HTML request: a full server render on 36 of
   38 pages. The logo, desktop Home link and bottom-nav Home tab now point at the
   member's real home and never prefetch `/` while the handle is unknown.
6. **`/api/app-version` polled every 60 s forever**, hidden tabs and forgotten
   installed apps included (~60 invocations/hour/tab). Now visible-only, every
   5 minutes; the return-from-away check is unchanged. It was the only client
   interval that touched the network — the other 14 are local UI timers.
7. **Measurement beacons were standing costs** — web vitals (~0.75 beacons per
   page view, sampled per metric) and playback metrics (16% of every video
   mount, i.e. Reels swipes); each is an invocation plus a `console.log`, which
   feeds Observability Events, the largest bill line. Both off unless
   `NEXT_PUBLIC_VITALS_SAMPLE` / `NEXT_PUBLIC_PLAYBACK_METRICS_SAMPLE` is set.
8. **Guest-only waste** — `/api/messages` (unread badge), `/api/notifications`,
   `POST /api/auth/device-check`, PIN status and the inbox realtime socket ran
   for signed-out visitors on public app pages. Skipped without a session cookie
   (`lib/auth/has-auth-cookie.ts`, one shared test).

## Owner decision — KEEP the background warm-up (answered 2026-10-05)

> Asked with the numbers below; the owner chose **"Keep background warm-up"**.
> Do not re-propose intent-only warming without a new instruction.

**Idle prefetch of member pages and `<Link prefetch>` (99 uses).** Requested
for instant navigation (2026-08-18, 08-23, 09-14). Measured after the fixes, a
signed-in page view still makes ~6 full server renders of pages the member
did not open (`/home`, `/friends`, `/messages`, `/account`,
`/studio/ai/history`, `/feed`), and scrolling past post/profile links renders
each one (`/p/<id>`, `/u/<handle>` are `private, no-store`). Content pages
(`/learn`, `/help`, `/topics`, `/sounds`, …) are CDN-cached and cheap to
prefetch. The proposal: warm member pages on INTENT (pointer-down / hover,
already wired on every nav tab) instead of on idle; keep `loading.tsx`
boundaries so the tap still answers instantly.

## Left as designed

- `/api/streak` GET once per document (server-authoritative streak rule; client
  navigations reuse the cache).
- `/api/analytics/context` once per session (geo enrichment, edge runtime).
- `/api/app-version` once per page load (needed when a document is served from
  a cache older than the deploy).
- **Vercel Agent ($1.38)** is Vercel's AI code-review bot — a dashboard switch,
  nothing in this repo.
