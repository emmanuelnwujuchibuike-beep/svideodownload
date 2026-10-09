# Part 9 brief — global performance, thermal optimization and ad delivery (owner, 2026-10-09)

> Recorded from the owner's message, compressed but with every requirement
> kept. **Do not edit the requirements**; record findings and progress in
> `docs/PERFORMANCE.md` (Part 9 section).

**Scope: the whole app.**

- Download and its result pages
- Frenz AI (video, image, audio, avatar)
- Feed, Reels, AI Reels, Stories
- Wallpapers
- Wallet, credits, transactions, subscriptions
- Profiles and notifications
- The advertiser and admin dashboards
- Uploads, downloads, storage, auth, background work, APIs

**Objectives.**

1. Ad media is delivered from Supabase Storage or a CDN, never through Vercel
   Fast Origin routes.
2. Large uploads and downloads are never proxied through Vercel Functions or
   Railway.
3. Remove unnecessary work: CPU spikes, memory growth, extra requests and heat.
4. Cut Fast Origin, invocations, bandwidth, observability events, and Railway
   CPU and memory.
5. Preserve security, payments, AI reliability and features.
6. Audit, measure, prioritize, optimize, verify. Never rewrite blindly.

Do not claim that all heat can be eliminated.

## 1 · Audit

**Review.**

- Routes, layouts, bundles and dependencies.
- Hydration, effects, rerenders and handlers.
- Timers, intervals, observers, subscriptions and background tasks.
- Supabase queries, Realtime, auth listeners and database functions.
- API and Function invocation patterns, Fast Origin and large responses.
- Railway processes.
- Media upload, download, preview, transform and URL paths.
- Ad scripts and serving.
- Feed and Reels playback and preloading.
- AI polling, queues, result downloads and retries.
- Wallet, admin and analytics refreshes.
- Service worker, caching, fonts, animations and assets.
- Leaks, unbounded caches, duplicate requests and heavy computation.
- Logging and observability volume.

**Classify each finding** as one of: high CPU/thermal, high memory, excessive
network, high Fast Origin/bandwidth, excessive invocations, excessive
DB/Realtime, rendering bottleneck, leak, security-sensitive (keep), or already
optimized. Measure where possible. Never guess or delete without evidence.

## 2 · Supabase-first ad media

**The flows.**

- Upload: browser → short-lived authorization → direct Supabase upload.
- Delivery: browser → Storage/CDN.
- Config: a light API or DB query.

**Rules.**

- Use the existing buckets.
- Use narrow, short-lived authorization.
- Serve from Storage URLs with caching. Use signed URLs for private media.
- Store paths, not blobs. Keep credentials on the server.
- No open writes, and no proxying to hide URLs.
- No download-and-resend through Vercel or Railway, and no needless
  duplication.
- Validation stays separate from delivery.
- Vercel does only light authorization, payment and metadata work.

**Audit every media URL.**

- API routes returning bytes
- proxies used by img, video, CSS or downloads
- server fetch-and-retransmit
- upload handlers buffering whole files
- thumbnail or convert pipelines
- ad URLs pointing at app routes
- AI result downloads through servers

Replace them where compatible, without breaking signed access, ownership,
private media or provider compliance.

## 3 · Device heat and CPU (app-wide)

**JavaScript and rendering.**

- Remove needless rerenders and repeated expensive work.
- Stabilize dependencies where it measurably helps.
- Fix effect and request loops. No full-page rerenders.
- Virtualize and paginate large lists and tables.
- Defer non-essentials. Lazy-load AI tools, charts and admin.
- Remove a dependency only after confirming it is unused.
- No heavy synchronous main-thread work. No indiscriminate memoization.

**Timers and background work.** Audit every interval, timeout, animation loop,
observer, subscription and poll.

- Remove duplicates.
- Stop on unmount. Pause when hidden and resume smartly.
- No hidden animations or media.
- Use events over polling where useful, and adaptive polling otherwise.
- Clean up everything. A remount must never multiply tasks.
- Keep essential payment, security and AI-completion checks.

**Animations.**

- Short, efficient transitions only. Nothing continuous or decorative.
- Pause offscreen. Respect reduced motion.
- Avoid heavy blur, backdrop-filter and shadows on weak devices. Keep the
  premium look.

**Computation.**

- Use workers only where justified, never persistent ones without need.
- Avoid repeated parse, sort or filter over big data.
- Cache proven repeated results.
- Release references and object URLs.
- Use traces to prioritize.

## 4 · Feed, Reels, AI Reels, video

- Autoplay only the most-visible active video. Pause when offscreen or hidden.
- Never decode many at once.
- Do not preload whole feeds: use posters, and metadata-only or no preload.
- Load progressively by viewport and network, at the right
  resolution and bitrate.
- Release references.
- Do not churn video elements while scrolling.
- One video plays at a time where intended.
- Keep the play/pause and sound controls accessible.
- Use observers, not scroll handlers.

**Ads in video experiences.**

- Rewarded ads and interstitials fetch a small metadata pool and load the
  chosen creative only when needed.
- Never load an ad video just because the page has a slot.

## 5 · AI generation

**Submission and status.**

- Submit once, with an idempotency key.
- No duplicate submissions from rerenders or double-clicks.
- Use the existing queue.
- Use Realtime where reliable, otherwise adaptive polling with backoff.
- Stop at the terminal state and clean up.

**Results and money.**

- Deliver results directly from the provider or storage, not through Vercel.
- Keep credentials and payments on the server.
- Keep refunds, accounting, recovery and failure handling intact.
- No retry loops that re-submit paid jobs, and no duplicate processing.
- Count text-to-audio characters locally, with no request per keystroke.
- The server stays the authority for cost, balance, entitlements and
  completion.

## 6 · Supabase queries and Realtime

**Queries.**

- Remove duplicate queries and waterfalls.
- Select only needed columns. Paginate.
- Add indexes for proven hot paths. Inspect slow queries.
- Aggregate dashboards.
- Reuse config and entitlements, and cache stable config. Avoid unrelated
  invalidation.

**Realtime.**

- Use it only where live updates help. Remove duplicate channels.
- Scope narrowly and clean up.
- Use refresh or adaptive polling for low-priority data. No 1-second admin
  refresh.

**Never.**

- Never cache balances, permissions or entitlements unsafely.
- Never just shift load to the DB without measuring both sides.

## 7 · Vercel Fast Origin and bandwidth

**Investigate.**

- media through routes
- repeated config responses
- repeated SSR fetching
- uncached public content
- full media in API responses
- hydration and navigation duplicates
- large JSON
- repeated signed-URL calls
- polling loops and analytics frequency
- AI results through functions
- SSR that could be static

**Remedies.**

- Direct Storage/CDN delivery.
- CDN caching for public content, and conditional revalidation.
- Pagination and lean responses.
- Deduplication and safe client caching.
- Static or ISR pages.
- Remove polling.

Respect auth, cache-control and private data. Never publicly cache user data,
and keep the dynamic behavior that is needed.

## 8 · Railway

- Remove duplicate workers and polls.
- Bound jobs, with no endless retries.
- Never hold whole files in memory. Stream in bounded chunks only when
  needed.
- Limit concurrency. Use timeouts, cancellation and backoff.
- Release resources and reuse the queue.
- No process for ad rotation or dashboard refresh, and no always-on service
  for light config.
- Set limits.
- Never remove a needed service without replacing its role. Document each
  service.

## 9 · Ad delivery engine (Parts 1 and 5)

**Loading.**

- Resolve eligibility from light metadata.
- Load ads asynchronously after the main content. Never block LCP or
  navigation.
- Reuse the canonical slots.

**Top banner.**

- 32 px tall, below the header.
- A default pool of 10, rotating every 5 s locally from the loaded pool.
- No server call per rotation. Never load all 10 videos.

**Interstitials and reward videos.**

- Interstitials (including the download-completion one) don't repeat
  consecutively when there are alternatives.
- Reward videos load on demand, within the maximum duration.

**Failure handling and limits.**

- Skip broken creatives. Render nothing when there is no inventory, with no
  aggressive retries.
- Respect caps, dates, provider eligibility, consent and the kill switch.
- Isolate failures. Do not init every provider script on every route.

Preserve AdSense, ExoClick, Monetag, Hilltop and the others. Consolidate
duplicate renderings without losing legitimate monetization.

## 10 · Admin dashboard performance

- Paginate tables. Lazy-load charts and event views.
- Use aggregates for overviews. Never fetch all campaigns or events.
- No needless auto-refresh. Refresh per screen, deliberately or by hand.
- No autoplaying video in rows: use thumbnails.
- Keep config server-authoritative.
- An idle dashboard does no continuous CPU or network work.
- Keep the emergency controls, reconciliation and alerts.

## 11 · Leaks and lifecycle

**Audit.**

- object URLs, and media playing after navigation
- streams and listeners, including duplicate auth listeners
- leaked Realtime channels and surviving timers
- unbounded caches and large retained arrays
- repeated decoding and double-attached handlers
- async updates after unmount
- duplicate WebSockets
- excess cross-route state

**Fixes.** Fix what is verified, with cancellation, cleanup, bounded caches
and disposal. Never clear state that navigation, payments or AI jobs need.

## 12 · Caching policy per data class

| Data | Policy |
|---|---|
| Public media | Storage/CDN cache, immutable or versioned |
| Private media | Signed URLs |
| Ad config | Cached, invalidated on admin change |
| Campaign metadata | Efficient |
| User state | Careful, never leaked across users |
| Balances | Server-authoritative |
| AI status | Stops at the terminal state |

Do not re-download without a reason. Version the creative URLs so a
replacement is never stale forever.

## 13 · Overheating response

- Pause hidden video and stop offscreen animation.
- Preload less on constrained networks and devices.
- Defer heavy components. Avoid simultaneous heavy work.
- Use bounded listeners and respect lifecycle and reduced motion.
- No hidden charts or feeds.
- Give users autoplay controls where appropriate.
- Use only real browser signals. Never invent temperature detection or shut
  down core features. Reduce optional work first.

## 14 · Measure

**Metrics.**

- LCP, INP, CLS, TTFB
- bundle size and long tasks
- CPU and memory
- active videos and subscriptions
- requests and bytes, and duplicate calls
- DB latency
- Fast Origin, invocations, bandwidth and observability events
- Railway, and Supabase load and egress

**Rules.**

- Target LCP ≤ 1.6 s where realistic, reported per route. It is not a
  guarantee.
- Compare ads on and off, desktop and mobile.
- Never fabricate a baseline.

## 15 · Regression testing

**Must not break.**

- auth and session recovery
- downloads and history
- AI jobs and recovery
- wallet, deductions and refunds
- payments and subscriptions
- upload authorization and private media
- Feed, Reels, AI Reels and Stories
- campaign creation and live editing
- ad rotation and providers
- emergency controls
- fraud and safety
- notifications and Realtime

**Also test.**

- slow networks
- empty inventory
- failed media
- background and foreground transitions
- navigating during a job
- remount cycles

## 16 · Phases

- A: baseline audit
- B: critical fixes (proxies, runaway timers, duplicates, polling, leaks)
- C: rendering and media
- D: backend and infra
- E: ads
- F: verify

Go highest-impact first. No wholesale rewrite or giant risky migration.

## 17 · Final report

Report:

- the bottlenecks, with evidence
- the routes and components optimized
- the leaks fixed
- the media paths changed, and whether large media still passes through
  Vercel
- before/after Fast Origin, bandwidth and invocations, where data exists
- Railway and Supabase implications
- the rendering, network and media improvements
- the tests run
- the remaining issues and unverified claims

State plainly what could not be measured.
