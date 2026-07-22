# AGENTS.md — how to work in this repo

For AI coding assistants **and** new engineers. Read this first. It is short on
purpose; the depth lives in the registries and docs it points at.

Frenzsave (brand: **Frenz**) is a Next.js 15 App Router PWA — a social super-app
built around a media downloader. TypeScript strict, React 19, Supabase (Postgres
+ RLS), Cloudflare R2/Stream, Upstash Redis. A **modular monolith**: one backend,
many surfaces.

## The golden rules (do not break these)

1. **The 2-second cold-entry budget is the #1 rule.** A cold visit to a public
   entry route (`/`, downloader pages) must open fast. Cold-entry route JS weight
   is a **ratchet** (`lib/perf/budget.test.ts`) — it only moves down unless you
   write a justification. Code-split anything not needed at first paint.
2. **Truth rule.** A `live` registry entry must point at a file that exists (tests
   enforce it). **Never show a fabricated statistic** — a real measured number or
   nothing.
3. **Tests have teeth.** A guard that can't fail proves nothing. Every registry
   test includes a case that fails on a bad fixture. Assert on the real artifact
   (the build manifest, the DB, a screenshot), not a green checkmark.
4. **Fail open on non-critical reads; never gate a critical action on a round
   trip.** (Sign-out must never depend on a server call — see `docs/SECURITY.md`.)
5. **Don't rebuild what exists, and don't over-build.** Most "enterprise platform"
   asks map onto systems already here — read before designing.

## Where things live

- `app/` — routes. `(marketing)` = public/static; `(app)` = the signed-in shell.
- `features/<feature>/` — a feature's UI + client stores.
- `lib/` — shared logic. `lib/platform/` is the **kernel**.
- `docs/` — the governing docs (architecture, security, performance, …).
- `scripts/` — codegen + automation (`*.mjs`, run via npm scripts).
- `supabase/migrations/` — the schema (the authority; catalogued by data-domains).

## Start here to navigate

- **`lib/platform/registries.ts`** — the registry of registries (the Architecture
  Navigator). Every single-source-of-truth list, mapped to real code.
- **`lib/platform/engineering-registry.ts`** — every doc, generator, SDK and
  standard (the Developer Knowledge Hub).
- **`lib/platform/engineering-standards.ts`** — the conventions, with how each is
  enforced. Follow them.
- **`docs/DEVELOPER_EXPERIENCE.md`** — the full DX platform.
- **`docs/CONSTITUTION.md`** — the invariants + the honest Gap Ledger.

## Before you commit

```bash
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint        # ESLint, must be clean
npm test            # Vitest — run AFTER a build if you touched a budgeted route
npm run build       # required to measure route weight (budget.test reads .next)
```

Conventional Commit messages. End the body with the `Co-Authored-By` trailer.

## Adding something

- **A component/feature** → put it in `features/`; reuse tokens (`design-tokens.ts`)
  and catalogue it in `component-registry.ts`. No hardcoded hex or magic ms.
- **An API route** → declare it in `api-registry.ts`; the SDK (`lib/sdk`) is the
  typed client over it.
- **A DB table** → add a migration and give it a home in `data-domains.ts`
  (the orphan test fails otherwise).
- **A registry/catalogue** → point every `live` entry at a real file and add a
  teeth test that fails on a missing source.
- **An ad zone** → change `AD_ZONES`, the `AdZone` type and the zone meta together
  (`ad-slots.test` guards that they agree; a page naming ≥3 zone literals is a
  second registry — wrap it).

## Reality, not theatre

Deferred work is marked `planned` and never implied as done. If a spec seems
over-built, build the data-driven version of ALL of it and flag concerns
alongside delivery — don't silently trim. See the Gap Ledgers in `docs/`.
