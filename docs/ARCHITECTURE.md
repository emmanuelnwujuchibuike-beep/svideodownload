# Frenzsave Platform Architecture

> One seamless product to the user. Internally, a set of independent modules that
> can grow without slowing each other down. This document is the contract every
> current and future module follows.

## TL;DR — the load-time guarantee

The platform's #1 requirement is: **adding a new product must not slow down the
existing ones.** This is guaranteed structurally, not by discipline alone:

1. **Per-route code splitting is automatic.** Next.js App Router ships only the JS
   a route needs. Opening `/downloads` does not download `Community`, `AI`, `Cloud`,
   `Studio`, or `Admin` code. A 7th or 50th product route does not enlarge the
   bundle of any existing route. This is true *by construction* — our job is to keep
   it true, not to build it.
2. **Server Components are the default.** Most module code never reaches the
   browser. Client JS is opt-in (`"use client"`), so module count drives server
   code, not client bundle size.
3. **Cross-module code is lazy by contract.** A module's heavy client surface is
   loaded via `next/dynamic`, and modules never import each other's internals
   (enforced — see Boundaries). So one module can never pull another into your bundle.

If those three hold, "many products" costs ~0 on the hot path. Everything below
exists to keep them holding as we scale.

## Why a Modular Monolith (and not microservices — yet)

We deliberately run **one deployable** with **strictly isolated modules**, not a
fleet of services. For a platform at our stage this is the faster *and* cheaper
*and* lower-latency choice:

- **No network hops** between Download and Community → lower latency, the literal
  performance goal.
- **One deploy, one set of env, one CI** → velocity stays high as modules grow.
- **Independent scaling is still possible** where it matters via the worker split
  (see below) and edge/CDN caching — without N always-on processes burning memory.

The microservices option is **not closed off** — it's deferred. Every module is
written so it can be peeled into its own service later *without a rewrite* (clean
interfaces, no shared mutable state, no reaching into another module's tables).
That "exit path" is the real requirement; standing up 6 services today is not.

```
┌────────────────────────────────────────────────────────────────────┐
│                         Frenzsave (one app)                         │
│                                                                     │
│  PRODUCT MODULES (isolated, lazy)   PLATFORM CORE (shared, stable)  │
│  ┌──────────┐ ┌──────────┐          ┌─────────────────────────────┐ │
│  │ Download │ │Community │          │ Auth / SSO   Notifications  │ │
│  ├──────────┤ ├──────────┤          │ Users/RBAC   Payments       │ │
│  │ Studio   │ │ Cloud    │   ──────▶│ Settings     Analytics      │ │
│  ├──────────┤ ├──────────┤  (only   │ Search       Media Storage  │ │
│  │ AI       │ │ Admin    │  through │ Logging      Email          │ │
│  └──────────┘ └──────────┘  the core│ UI kit       Utilities      │ │
│       │             │       interface└─────────────────────────────┘ │
│       └─────────────┴── may use core; MUST NOT import each other ───┘ │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ heavy/CPU work proxied out
                  ┌────────▼─────────┐
                  │  Download Worker │  (yt-dlp / ffmpeg, scales alone)
                  └──────────────────┘
```

## The module contract

A "product" is a **module**. Every module:

1. **Registers itself** in `lib/platform/modules.ts` (id, route, icon, required role,
   nav entries, lazy loader). Adding a product = adding one registry entry. Nothing
   else in the platform needs to change to surface it in nav / RBAC / search.
2. **Owns a route subtree** under `app/<module>/...` and a feature folder under
   `features/<module>/...`. Its server logic lives under `server/services/<module>/`.
3. **Exposes a public API only** — a single barrel (`features/<module>/index.ts`).
   Other modules and the app shell import *that*, never deep internals.
4. **Talks to other modules only through Platform Core interfaces** (`lib/platform/*`,
   shared services). No module imports another module's folder. No module reads
   another module's database tables directly.
5. **Is lazy on the client.** Any non-trivial client surface is mounted via
   `next/dynamic` so it stays out of shared and sibling-route bundles.

### Boundaries (enforced)

- `features/<m>/internal/**` is private. Importing another module's `internal` is a
  lint error (`no-restricted-imports`, see `.eslintrc.json`). Public surface goes in
  the module's `index.ts`.
- Platform Core (`lib/platform`, `lib/supabase`, `lib/social` shared bits, `features/ui`,
  `features/app-shell`) may be imported by anyone. It must **not** import any product
  module — the dependency arrow points one way (modules → core).

## Platform Core (the shared, stable kernel)

Single source of truth for everything cross-cutting, so modules never reinvent it:

| Concern | Lives in | Notes |
|---|---|---|
| Auth / SSO | `lib/supabase`, `features/auth` | One Supabase session powers every module. |
| Users / RBAC | `features/auth/use-entitlements`, `lib/platform/rbac` | Role gates module visibility + access. |
| Notifications | `lib/social/notifications`, `features/app-shell/notification-bell` | Realtime, shared across modules. |
| Payments / subscriptions | `lib/paystack`, `app/api/billing` | One subscription unlocks Pro everywhere. |
| Analytics / logging | `lib/analytics`, `lib/notify` | Shared event pipeline. |
| Search | `app/api` search routes | Cross-module index (future). |
| Media storage | Supabase Storage + worker | Buckets are namespaced per module. |
| UI / design system | `features/ui`, `components`, `tailwind.config.ts` | Shared tokens; no per-module fork. |

## Performance guardrails (how we keep the guarantee)

- **Bundle budgets + analyzer.** `npm run analyze` renders the per-route bundle.
  Treat First-Load JS over budget on any route as a regression to investigate.
- **`optimizePackageImports`** for barrel-heavy deps (`react-icons`, `lucide-react`,
  `framer-motion`) so importing one icon doesn't pull the whole library.
- **Server-first.** New surfaces start as Server Components. Reach for `"use client"`
  only for genuine interactivity, and keep client leaves small.
- **Lazy module mounts.** `next/dynamic` for heavy client modules; prefetch on intent
  (hover/viewport) for instant-feeling navigation without eager download.
- **Edge/CDN + caching.** Static and cacheable responses served from the edge;
  request dedup and revalidation on shared data.
- **Offload heavy work.** CPU/memory-heavy jobs (transcode, large downloads) go to the
  worker, which scales independently of the web tier.

## Scaling exit paths (designed, not built)

When a single module genuinely needs to scale alone:

1. **Worker offload** (already live) — CPU-bound work runs out-of-process.
2. **Module → service** — because a module has no deep imports into others and reads
   only its own tables through its service layer, it lifts out behind the same public
   interface with no caller changes.
3. **Data partitioning** — per-module table ownership + soft deletes + audit logs make
   a module's data movable to its own store later.

## Security model (platform-wide)

RBAC at the module boundary (`requiredRole` in the registry) + per-row RLS in
Supabase + input validation (`zod`) + rate limiting (`lib/rate-limit`) + the security
headers in `next.config.ts`. Secrets live only in deploy env (Railway/Vercel), never
in the repo. Module media buckets are namespaced and RLS-scoped to the owner.

## Adding a new product (the whole checklist)

1. `app/<module>/` route subtree.
2. `features/<module>/` with `index.ts` public barrel; privates under `internal/`.
3. `server/services/<module>/` for server logic; own tables + migration.
4. One entry in `lib/platform/modules.ts`.
5. Done — nav, RBAC gating, and search pick it up from the registry.
