# Frenzsave Performance Engineering Plan

> Target: every interaction feels instant — on par with Facebook, X, Instagram,
> TikTok, Reddit, YouTube and LinkedIn — and stays that way at tens of millions
> of users. This is the ordered plan behind that goal. It is a living checklist,
> not a claim that everything below is done.

## Operating principles (apply to every change)

Before merging any feature, answer: *Can it render sooner? Fetch less? Cache?
Preload? Make fewer requests? Ship less JS? Feel faster? Scale to millions?* If a
slower-but-easier implementation is tempting, don't.

The non-negotiables:

- **Never block first paint on the network.** Render a skeleton instantly, fetch
  in the background, swap in data when it lands (stale-while-revalidate).
- **Server-first.** New surfaces are Server Components; `"use client"` only for
  genuine interactivity, kept to small leaves.
- **Cursor pagination + virtualization** for every list that can grow.
- **One request per need.** Dedupe, cache, and batch; never N+1.

## Status legend

✅ done · 🟡 partial / in progress · ⬜ planned

## Phase 0 — Foundations (this is where we are)

- ✅ Modular platform architecture + module registry (`docs/ARCHITECTURE.md`).
- ✅ Per-route code splitting (App Router, automatic).
- ✅ `optimizePackageImports` for barrel-heavy libs; bundle analyzer (`npm run analyze`).
- ✅ Unified versioned API (`/api/v1/app/*`) + response envelope + cursor pagination.
- ✅ Cross-platform SDK with retries, dedup, timeouts, typed errors (`lib/sdk`).
- 🟡 Realtime notifications (Supabase channels) — live; expand coverage.
- 🟡 IndexedDB media cache + localStorage history — live for downloads.

## Phase 1 — Perceived speed (instant feel)

- ⬜ **Skeleton screens** for every async surface (feed, profile, messages,
  downloads, search). No blank states, ever.
- ⬜ **Optimistic updates** for like / save / follow / comment / read-receipt.
- ⬜ **Instant navigation**: `next/link` prefetch on viewport+intent, persistent
  shells (already have the app shell), preserved scroll position on back.
- ⬜ **SWR/React Query-style client cache** over the SDK: background refresh,
  request dedup (SDK has in-flight dedup; add a time-based cache layer),
  cache keys per entity, optimistic mutation + rollback.
- ⬜ **Streaming SSR** (`loading.tsx` + Suspense) so shells stream before data.

## Phase 2 — Data & feed at scale

- ⬜ **Keyset/seek pagination** behind the existing opaque cursor (swap the codec
  in `respond.ts`; clients unaffected).
- ⬜ **Feed virtualization** (windowed rendering) + memory-efficient recycling.
- ⬜ **Prefetch next page** before the user reaches the end.
- ⬜ **Edge/CDN caching** for public, cacheable GETs; `revalidate` + tags for
  feed/news/trending; per-user data stays dynamic.
- ⬜ **Redis** (Upstash already a dep) for hot reads: sessions of trending,
  counts, suggestion sets, rate-limit buckets.
- ⬜ **N+1 audit** on `lib/social/*` queries; batch + index review.

## Phase 3 — Media pipeline

- ⬜ **Images**: `next/image` everywhere, AVIF→WebP→fallback, responsive
  `srcset`, lazy + blur placeholder, never serve oversized originals.
- ⬜ **Video**: adaptive bitrate (HLS), poster/first-frame preload, lazy mount,
  smart buffering, background transcode on the worker, CDN delivery.
- ⬜ **Thumbnails** generated and cached at upload.

## Phase 4 — Realtime surfaces

- ⬜ **Messaging**: realtime, typing indicators, read/delivered receipts, offline
  queue + auto-reconnect, optimistic send.
- ⬜ **Notifications**: instant unread count, optimistic read, efficient
  per-user channel subscriptions (subscribe only while mounted).
- ⬜ **Presence** for active friends.

## Phase 5 — Search

- ⬜ Debounced input, predictive suggestions, recent + trending, indexed search
  (Postgres FTS or external), incremental loading, result caching.

## Phase 6 — Observability & hardening

- ⬜ **Web Vitals** (LCP/INP/CLS) reporting + per-route budgets enforced in CI.
- ⬜ **Slow-query + slow-API detection**, error tracking, crash reporting,
  health checks, structured logs with the `X-Request-Id` the API already emits.
- ⬜ **Memory-leak guards**: dispose listeners/subscriptions on unmount,
  long-session profiling.

## Phase 7 — Native & desktop polish

- ⬜ 60–120fps animations, gesture responsiveness, low battery/memory on mobile.
- ⬜ Desktop: keyboard shortcuts, multi-column layouts, resizable panels.
- ⬜ Offline-friendly behavior via the SDK cache + service worker (web/PWA).

## How we keep the bar

- `npm run analyze` before shipping anything that touches the client bundle.
- Web Vitals budgets per route (Phase 6) fail CI on regression.
- Every PR answers the operating-principles questions above.
