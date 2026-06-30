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

- ✅ **SWR-style client cache** over the SDK (`features/data`): cached-first
  render, background revalidation, in-flight dedup, focus/reconnect revalidation,
  `useQuery` + cursor `useInfiniteQuery` (pages persist across navigation),
  optimistic `mutate()` with rollback. Dependency-free.
- ✅ **Skeleton primitives** (`features/ui/skeleton`): `Skeleton` / `SkeletonAvatar`
  / `SkeletonText` over the shared shimmer. 🟡 Apply per-surface presets next.
- ✅ **Next-page prefetch hook** (`useInView`, fires ~600px early) — the seamless
  infinite-scroll trigger.
- 🟡 **Optimistic updates**: primitive shipped (`mutate`); wire into like / save /
  follow / comment / read-receipt next.
- ⬜ **Migrate the home feed** to `useInfiniteQuery` + `getApi().feed()` + skeletons
  (reference surface; preserves all existing feed features).
- ⬜ **Instant navigation**: `next/link` prefetch on viewport+intent, preserved
  scroll position on back (data already persists via the cache).
- ⬜ **Streaming SSR** (`loading.tsx` + Suspense) so shells stream before data.

## Phase 2 — Data & feed at scale

- ✅ **Edge/CDN caching** primitive (`lib/api/edge-cache.ts`) + applied to the
  anonymous home feed (`s-maxage`/`stale-while-revalidate`); personalized
  responses send `private, no-store`. Extend to trending/news/public profiles.
- ✅ **Hot-read cache** `getCached()` with single-flight dedup over Upstash Redis
  (memory fallback) in `lib/cache.ts`. Redis already wired for rate limits + daily
  caps — provision Upstash to share it across instances (see INFRASTRUCTURE.md).
- 🟡 **Prefetch next page** — `useInView` hook shipped (Phase 1); wire into the feed.
- ⬜ **Keyset/seek pagination** behind the existing opaque cursor (swap the codec
  in `respond.ts`; clients unaffected).
- ⬜ **Feed virtualization** (windowed rendering) + memory-efficient recycling.
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
