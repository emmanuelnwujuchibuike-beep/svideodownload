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
health checks (`/api/health`) · alerts.

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
