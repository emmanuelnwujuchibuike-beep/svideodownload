# Feature 18 · Part 25 — Enterprise Profile Architecture (final)

The closing part of Feature 18. It is a **blueprint**, not a build.

---

## 0. What this document refuses to do, and why

The brief asks for independently deployable microservices, an event bus with
versioned events, a plugin sandbox, multi-region replication with automatic
failover, GraphQL and streaming APIs, and native SDKs for iOS, Android and
desktop.

**Frenzsave is one Next.js application on Vercel with Supabase Postgres, R2 for
objects and Upstash for rate limits.** There is no message broker, no service
mesh, no second region, and no native app.

Writing documentation that describes those things as though they exist would be
the most damaging thing in this repository. Architecture docs get consulted and
believed — by whoever picks this up next, and increasingly by models reading it
to answer questions. This project has already had to correct a standards file
that described RTL as "deferred" on the day four RTL locales shipped, and an
analytics dashboard that sold a 20,000-row sample as an exact count. A fabricated
service topology is the same failure at architecture scale, and it outlives the
person who wrote it.

So this records **the architecture that exists**, the properties worth keeping,
and the order in which the brief's ambitions become real if the product ever
needs them.

---

## 1. What is actually here, and why it is more than it looks

The brief's "domain-driven design" is largely already implemented — not as
services, but as **registries**. That distinction matters and is the single most
important architectural fact about this codebase.

| Brief's ask | What exists | Where |
|---|---|---|
| Domain architecture | 21 domains, every table owned by exactly one | `lib/platform/data-domains.ts` |
| Module Registry | Declared capabilities, availability derived | `lib/platform/*.ts` |
| Settings domain | 24 categories, ~50 settings, ranked search | `lib/settings/` |
| Accessibility domain | Presets, WCAG maths, `<head>` application | `lib/a11y/` |
| Trust domain | Levels → capabilities, derived per read | `lib/devices/trust.ts` |
| Privacy / portability domain | Per-domain classes, owner columns | `lib/portability/` |
| Design system | Principles, motion, a11y contract, themes | `lib/platform/design-system.ts` |
| Observability | Page catalogue, metric specs, SSE stream | `lib/analytics/` |

### The pattern: declare, then derive

Nothing above is runtime infrastructure. Each is a **catalogue that costs
nothing to run and is enforced by a test**:

- `data-domains.test.ts` fails the build when a migration adds an uncatalogued
  table.
- `ad-slots.test.ts` fails when a zone list is re-declared anywhere else.
- The settings test fails when a `live` setting points at a route nothing serves.
- `tables.test.ts` fails when a table in an exportable domain has no export
  decision.

This is what gives the codebase its actual scaling property, and it is not the
one the brief asks for. **A new capability cannot be added quietly.** It has to
be declared, and the declaration is checked against reality. That is worth more
at this size than service isolation would be, because the failure mode here has
never been "one service brought down another" — it has always been "something
was added and nothing noticed", which is precisely what these guards catch.

### The invariants worth protecting

Learned expensively, each recorded where it applies:

1. **Registry over runtime.** A catalogue is free; a service is not.
2. **Derive availability, never assert it.** A declared thing that does not
   exist must fail closed.
3. **No global runtime that touches navigation.** Root-layout client components,
   `pushState` patches and `MutationObserver` on `<html>` have silently broken
   App Router prefetch here. Deferring *when* an island mounts is fine; adding
   one that intercepts routing is not.
4. **The cold-entry budget outranks decoration.** 275 kB, asserted on the build
   artifact by name.
5. **Never state a number you did not measure.** Applies to analytics, resolution
   badges, file sizes and user counts equally.
6. **A 4xx is a verdict; a 5xx is "ask again".** Never report absence because a
   dependency hiccuped.

---

## 2. The evolution path

Ordered by what the product would actually need first, with the trigger that
should prompt each. None is worth doing before its trigger.

### Stage 1 — extraction to a worker (partly done)

**Trigger:** an operation exceeds the serverless execution limit.
**Status:** already happened. Telegram MTProto and video transcoding run on a
Railway worker, because they need long-lived connections and FFmpeg.

The lesson generalises: **the first thing to leave the monolith is whatever
cannot physically run inside a request.** Not a domain — a constraint.

### Stage 2 — a job runner

**Trigger:** the first feature that must survive the request that started it.
Part 24's backups and restores are exactly this and are the reason they are not
built.

Smallest thing that works: a `jobs` table, a cron route, and a status a UI can
poll. Not a broker. This unlocks scheduled backups, bulk exports, media
re-encoding and the wallpaper dimension backfill that is still run by hand.

### Stage 3 — an event log

**Trigger:** two independent consumers need the same fact.

`lib/events` already emits in-process (`download.completed`). Making it durable
means appending to a table with a `type`, a `version` and a payload — which is
also the versioning the brief asks for. **Version from the first row**, because
retrofitting a version onto events already written is not possible.

### Stage 4 — read replicas / a second region

**Trigger:** measured p95 read latency that a cache cannot fix.
Supabase RTT is ~290 ms from the current region. Most of what looks like a
database problem here has been a *waterfall* problem — sequential awaits that
should have been parallel — and that is free to fix.

### Stage 5 — service extraction

**Trigger:** two parts of the product need genuinely different deploy cadences or
scaling profiles, and the team is large enough that a shared deploy is a
bottleneck.

**This is the last stage, not the first.** Splitting a single-team product into
services buys isolation nobody needs and pays for it in distributed transactions,
cross-service auth and a debugging story that gets much worse. The domain
boundaries are already documented, so the split — if it is ever right — is a
mechanical exercise rather than an archaeology one.

### Stage 6 — native SDKs

**Trigger:** a native app exists.
There is no native app; the PWA is the mobile surface. `/api/v1/app/*` is already
REST-shaped and versioned, which is the contract an SDK would wrap. The wrapper
is the easy part.

---

## 3. Where the brief's items actually stand

| Asked for | Status |
|---|---|
| Domain architecture | **Real** — as registries |
| Module Registry | **Real** — `lib/platform/*` |
| Feature flags | **Real** — `feature_flags`, `experiments` |
| Observability | **Partly** — analytics + SSE + web vitals; no tracing |
| Security model | **Partly** — RLS, passkeys, audit log, device trust; not zero-trust between services, because there are none |
| Versioned APIs | **Partly** — `/api/v1/app/*`; no deprecation policy |
| Testing | **Partly** — 1,726 unit/contract tests; no E2E, no load, no chaos |
| Event-driven platform | **In-process only** |
| Microservices | **No** — see Stage 5 |
| GraphQL, streaming APIs | **No** — REST + one SSE stream |
| Plugin sandbox | **No** — a plugin platform without a security boundary is a vulnerability |
| Multi-tenant, multi-region, DR | **No** |
| AI orchestration | **No** — no LLM integration exists anywhere |
| Spatial / AR / VR / BCI / quantum-safe crypto | **No**, and no work should be done against them today |

---

## 4. The performance contract

The numbers that constitute "fast enough", and how each is defended:

- **Cold entry under 1.6 s** — the owner's standing rule.
- **275 kB first-load ceiling** on the landing — `lib/perf/budget.test.ts` fails
  by name.
- **CLS under 0.1** — earned back from 0.684; the cause was a single
  `content-visibility` wrapper with one placeholder height over ten sections.
- **LCP is gated on the first hydration task**, measured twice. The lever is
  therefore what hydrates, not what downloads — which is why five root-layout
  islands now mount a paint later.
- **No `backdrop-filter` on anything that repeats per list item.** It is a GPU
  pass that promotes a layer even at `opacity: 0`.

## 5. Closing

Feature 18 is complete across 25 parts. The profile platform's foundation is a
set of tested registries with derived availability, a design system with an
enforced accessibility contract, and a performance budget asserted on the build
artifact.

The most valuable property is not any single feature. It is that **the gap
between what this codebase claims and what it does is checked by tests**, and
that every part of Feature 18 was required to say what it did *not* build.
Keeping that honest is the thing worth protecting as it grows.
