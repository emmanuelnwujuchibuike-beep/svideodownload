# 💙 Frenz Core — the engineering foundation of the Frenzsave ecosystem

> **This is the canonical reference. Every feature integrates with Frenz Core. Nothing bypasses it.**
> Frenz Core is **not** a user-facing feature — it is the operating architecture that powers every
> Frenzsave application, service, API, and future platform. Read this before building any feature.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [API.md](API.md) · [PERFORMANCE.md](PERFORMANCE.md) · [INFRASTRUCTURE.md](INFRASTRUCTURE.md)

---

## Mission

One intelligent platform powering the complete ecosystem. Every service works together; every
platform shares **one backend**; every user has **one identity**; every feature integrates
seamlessly; the architecture stays maintainable as the ecosystem grows to **billions of users**.

Principles: **Build once. Reuse everywhere. Never duplicate logic.** Everything modular, scalable,
testable, documented, observable, secure, accessible, synchronized, privacy-first, cloud-native.

---

## Unified platform architecture

**ONE enterprise backend.** Never separate backends per platform. All clients — Web, Android,
iPhone, iPad, Windows, macOS, Linux, future Smart TVs / Wearables / Automotive, plus Public APIs &
SDKs — share the same: Authentication · Users · Database · Storage · Cloud · Notifications ·
Realtime · Permissions · Search · Analytics · Security · Logging · Identity · Settings.

### Shared services (every app connects to the same ones)
API Gateway · Authentication · Identity · User · Friend · Messaging · Realtime · Notification ·
Media · Cloud · Storage · Business · Creator · Admin · Monetization · Safety · Developer Platform ·
Feature Registry · Analytics · Audit · Search · Recommendation.

### Microservices (logical domains — modular monolith now, extractable later)
Identity · Authentication · Messaging · Notifications · Media · Reels · Status · Collections ·
Vault · Cloud · Experiences · Studio · Business · Store · Payments · Developer Platform · Safety ·
Moderation · Verification · Analytics · Admin · Search · Recommendation · Localization.

> **Stance:** modular monolith with clean interfaces + a feature registry, so each domain can peel
> into its own service later without a rewrite. See [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Infrastructure targets

| Concern | Target | Today in this repo |
|---|---|---|
| Primary DB | PostgreSQL | ✅ Supabase Postgres (RLS, migrations) |
| Cache | Redis | ✅ Upstash Redis (`lib/cache.ts`, single-flight `getCached`) |
| Object storage | S3-compatible | ✅ Cloudflare R2 (`lib/storage`), Supabase for small files |
| Media/video | Adaptive streaming | 🟡 Cloudflare Stream wired (`lib/media/stream.ts`, opt-in) |
| Search | OpenSearch | ⬜ planned (basic search today) |
| Realtime | WebSockets | ✅ Supabase Realtime (notifications, messages, feed) |
| Message queue | Kafka or equivalent | ⬜ planned (worker queue today) |
| CDN / edge | Global CDN | ✅ Vercel edge + Cloudflare CDN |

## API platform
REST · GraphQL · Realtime/WebSockets · Webhooks · Public + Internal APIs · Versioning · OpenAPI.
- Today: versioned first-party API `/api/v1/app/*` (bearer **or** cookie auth), API-key dev API
  `/api/v1/*`, worker-secret internal API `/api/internal/*`. Response envelope + opaque cursor in
  `lib/api/respond.ts`. Cross-platform SDK in `lib/sdk`. GraphQL/webhooks = planned.

## Authentication
OAuth · OpenID Connect · Passkeys · JWT · Refresh tokens · MFA · Biometric · Device auth.
- Today: Supabase Auth (cookie sessions for web + bearer JWT for native/desktop), `getSessionUser`
  in `lib/api/authenticate.ts`. Passkeys/MFA/device auth = planned on top of this.

## Realtime engine
Messages · Typing · Presence · Calls · Video · Notifications · Status · Comments · Likes · Reposts ·
Followers · Friend requests · Collections · Spaces · Experiences — **everything updates instantly.**

## Notification engine
Push · In-app · Email · SMS · Scheduled · Grouped · Smart priority · Cross-device sync.

## Cloud platform
Unified cloud · Realtime sync · Offline engine · Backups · Storage · Version history · Media
processing · Global CDN.

## Search engine
Universal · Natural-language · Media · OCR · Voice · Global index.

---

## Design system
Glassmorphism · Electric Blue · Electric Purple · premium motion · premium icons · consistent
typography & spacing · premium components · responsive & adaptive UI. (See `Frenz`/`FrenzSave`
brand — brand name memo in project memory.)

## Performance
Lazy loading · edge CDN · Redis caching · streaming · background processing · predictive/prefetch
loading · offline support · battery optimization · 60fps animations. Roadmap: [PERFORMANCE.md](PERFORMANCE.md).

## Loading Architecture (MANDATORY — every page, every future feature)
The app must feel already-loaded: no blank screens, no full-screen spinners, no layout shift, never
blocked input. Every route renders in layers — **shell → skeleton → critical data → media →
background** — and every new feature inherits this engine instead of inventing its own.

1. **Instant shell.** The `(app)` layout (topbar/sidebar/bottom nav) is persistent and never
   re-renders on navigation. Route content streams behind `<Suspense>`; page-level work never
   blocks the shell.
2. **Intelligent skeletons.** Every route has a `loading.tsx` that mirrors the final layout using
   the shared primitives in `features/ui/skeleton.tsx` (`Skeleton`, `SkeletonAvatar`,
   `SkeletonText`, `SkeletonRow`) wrapped in `SkeletonSection` (announces "Loading…" to screen
   readers). Section-level fetches use matching local skeleton fallbacks. Shimmer, exact
   dimensions, zero jump on swap.
3. **Hero-instant, sections-skeleton (MANDATORY pattern — owner directive 2026-07-07, the
   TikTok/SofaScore/Facebook feel).** On every page with a hero/identity/greeting area, that hero
   renders SYNCHRONOUSLY (no `await`, no Suspense boundary above it) the instant the page is hit —
   never gated behind any data fetch. Every section BELOW it streams independently behind its own
   `<Suspense>` with a skeleton matching that section's exact final layout, so a first-ever visit
   shows real content up top immediately while everything else fills in progressively, and a cached
   revisit shows everything instantly. **Canonical reference implementation:**
   `app/(app)/home/page.tsx` — the identity/redirect check is the only thing blocking first paint
   (no greeting hero anymore — removed 2026-07-09 per the Feature 17 header spec, "content is the
   hero, the header/chrome should never waste space on a per-visit greeting"), then
   `StoriesSection`/`ReelsSection`/`SmartFeedSection`/`RailSection` each stream behind their own
   boundary with a purpose-built skeleton (`StoriesSkeleton`, `ReelsSkeleton`, `FeedSkeleton`, a
   plain `Skeleton` for the rail). For pages that DO have a real above-the-fold hero (identity ring,
   profile header, etc.), render it with zero data dependency (or only the cheapest identity check)
   and Suspense-stream everything else with a skeleton sized to match — Home just no longer needs
   one.
4. **Critical data first.** Server components stream the identity/text layer first; counts, media
   and rails follow in their own Suspense boundaries. Client revisits are instant via the Router
   Cache (`staleTimes` in next.config) + the SWR data layer (`features/data`).
5. **Media loads progressively.** Images: `next/image` (AVIF/WebP, sized) behind
   `features/ui/fade-image.tsx` (`FadeImage` — decoded fade-in, no pop) over a shimmer/blur
   backdrop. Videos: poster first, `preload="metadata"`, IntersectionObserver autoplay
   only-in-view, unload off-screen (see reels/feed players). Never crop; never block paint.
6. **Background layer.** Anything not needed for the current viewport defers through the loading
   engine (`lib/loading/priority.ts`): `afterInteractive()` for idle-time work,
   `whenVisible(el, cb)` / `features/ui/lazy-mount.tsx` (`LazyMount`) for below-the-fold sections.
   No polling, no busy-waiting — battery-neutral by construction.
7. **Freshness without staleness.** The service worker (`public/sw.js`) is cache-first ONLY for
   immutable assets, network-first for navigations (with navigation preload), never touches
   media/API. Deploys reach every open tab and installed PWA via the build-stamp check
   (`/api/app-version` + `RegisterServiceWorker`), which reloads once on resume.

Rules: no new spinners covering content; no fetch waterfalls where a Suspense boundary can stream;
every `loading.tsx` uses the shared primitives; every below-fold rail goes through
`LazyMount`/`whenVisible`; reduced motion is respected (shimmer + fades are opacity-only).

## Security (Zero Trust)
RBAC + ABAC · E2E encryption where applicable · encrypted storage & backups · audit logs · threat
& fraud detection · device monitoring. Secrets live only in platform env vars (never committed).

## Accessibility
Screen readers · voice nav · keyboard nav · reduced motion · high contrast · large touch targets ·
captions · accessibility APIs.

## Localization
Multi-language · RTL · regional formatting · time zones · currencies · automatic translation.

## Observability
Centralized logging · distributed tracing · metrics · performance monitoring · crash reporting ·
health checks (`/api/health`) · alerts. Real-user signal today (privacy-preserving, ~15% sampled,
fire-and-forget to `/api/vitals`, no third-party RUM service): Core Web Vitals (`features/perf/web-vitals.tsx`),
video playback quality (`/api/metrics/playback`), and scroll FPS + JS heap memory
(`features/perf/scroll-perf-monitor.tsx`, Feature 17 Part 15).

## Testing Strategy (MANDATORY — every new pure/logic function)
Vitest (`npm run test`, wired into `.github/workflows/ci.yml` — every push/PR). Real unit tests,
colocated as `<file>.test.ts` next to the source (see `lib/social/home-feed.test.ts`,
`lib/social/friend-activity.test.ts`, `lib/offline/action-queue.test.ts`,
`lib/social/home-preferences.test.ts`, `lib/auth/device-check.test.ts`, `lib/social/smart-feed.test.ts`,
`lib/auth/device-label.test.ts` — Feature 17 Part 15, the session that first noticed this repo had
**zero** committed tests despite months of hand-verified logic). Rule going forward: any new
non-trivial pure function (ranking, scoring, decision logic, data transforms) gets a real exported
function + a colocated test — not a throwaway scratch script that never reaches the repo. Component/
UI/E2E testing (Playwright) is a separate, larger investment not yet started.

---

## Cross-cutting shared engines (NON-NEGOTIABLE)

Every feature MUST route through these. **No feature builds its own.**

- **Feature Registry** — every feature registers itself; states: Enabled · Disabled · Beta ·
  Coming Soon · Regional · Subscription-only · Platform-specific · Experiment. **No feature is
  hard-coded.** (Today: `lib/platform/module-registry.ts` + `modules.ts`.)
- **Shared Identity** — one account, username, profile, Prestige, Bond, Avatar, Settings profile,
  Privacy profile, Cloud, Wallet. One identity everywhere.
- **Shared Permission Engine** — one centralized engine for profile, messages, calls, location,
  collections, vault, studio, business, store, developer APIs, admin — everything.
- **Shared Analytics** — usage, performance, growth, creators, businesses, developers, system
  health, crashes, retention.
- **Shared Administration** — everything connects through **Frenz Admin Center**; no per-feature
  admin panels.
- **Shared Monetization** — everything connects through **Frenz Monetization Center**; no
  per-feature payment logic.
- **Shared Cloud** — every file/image/video/document/project/backup/Collection/media asset uses
  **Frenz Cloud**.
- **Shared Safety** — every feature integrates **Frenz Safety Center**: reporting, moderation,
  appeals, spam protection, fraud detection.
- **Shared Developer Platform** — every public integration uses **Frenz Developer Platform**:
  SDKs, APIs, webhooks, plugins, extensions.

---

## Final goal
The world's most advanced digital platform foundation — one unified backend, one identity platform,
one cloud infrastructure, one security model, one design system, one scalable enterprise
architecture supporting billions of users while remaining elegant, maintainable, resilient, and
future-ready for decades.

---

### How to use this doc when building any feature
1. Which **shared engines** does it touch? Wire into them — do not reimplement (identity, permissions,
   cloud, monetization, safety, analytics, admin, notifications, realtime, search).
2. Register it in the **Feature Registry** with the right state (Beta/Regional/Subscription/etc.).
3. Expose it through the **unified API** (`/api/v1/app/*`) so web + native + desktop share it.
4. Respect the **performance, security, accessibility, localization, observability** bars above.
5. Update this doc's status table if it advances a foundation capability.
