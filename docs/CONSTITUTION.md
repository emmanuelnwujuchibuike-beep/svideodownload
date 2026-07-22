# The Frenzsave Engineering Constitution

> One product to the user. A set of isolated modules to us. This is the governing
> document every current and future Frenzsave surface inherits — Website, Landing,
> Web App, PWA, and any future native/desktop client. Where an article names a rule,
> it also names the thing that **enforces** it. A rule without an enforcer that can
> *see* it fail is a comment, not a law.
>
> This document does not replace [ARCHITECTURE.md](./ARCHITECTURE.md),
> [SECURITY.md](./SECURITY.md), [PERFORMANCE.md](./PERFORMANCE.md), or
> [FRENZ_CORE.md](./FRENZ_CORE.md). It sits above them: it states the invariants and
> points at where each is defined and enforced. Those documents are the detail.

---

## Article I — The Invariants (these outrank features)

An invariant may not be traded away for a feature. If a change would break one, the
change is wrong, not the invariant.

1. **The 2-second budget.** A cold entry to any page renders in ≤ 2s on the target
   network. This is the owner's #1 rule and it outranks every feature.
   *Enforced by:* the load-time guarantee below + measurement on the **live** site,
   cache disabled, worst-of-3–5 runs (a single run proves nothing — variance is huge).

2. **The load-time guarantee: a new product must not slow the existing ones.**
   Guaranteed structurally, not by discipline — per-route code splitting, Server
   Components by default, cross-module code lazy by contract.
   *Enforced by:* `next/dynamic` module mounts, `no-restricted-imports` on module
   internals, and `npm run analyze` as a bundle regression check. See
   [ARCHITECTURE.md](./ARCHITECTURE.md) "the load-time guarantee".

3. **Truth by construction — the Reality Ledger.** No surface may claim a product,
   count, or capability exists until a route or datum *proves* it. Present tense is
   earned; unbuilt things speak in future tense.
   *Enforced by:* `ProductVeracity` in [module-registry.ts](../lib/platform/module-registry.ts)
   and `lib/content/reality-ledger.test.ts`. This project has shipped copy for
   products that never existed and front-door numbers off by four orders of
   magnitude — this article is the scar tissue.

4. **No fabricated data, ever.** Stats, counts, testimonials, engagement — if it
   isn't real, it doesn't ship. Offer a live counter as the honest big number.

5. **Security & privacy by design.** RBAC at the module boundary, RLS per row, `zod`
   at every input, rate limiting on every mutation, secrets only in deploy env.
   *Enforced by:* [SECURITY.md](./SECURITY.md) rules + RLS policies shipped in the
   same migration that creates a table.

6. **Every rule ships with an enforcer that can see it fail.** `tsc` + lint + unit
   tests + a green build prove almost nothing about behavior. Visual changes need a
   screenshot; bundle claims need two builds; error codes need a real request; a new
   guard must be proven able to fail. See
   [feedback: run the check that can see the failure](../CLAUDE.md).

7. **The repo is public.** No secrets, no row counts, no private numbers in code,
   docs, or commits — including this file.

---

## Article II — Experience OS: the shared spine

Every product is a *workspace* on one spine. Users never feel they are switching
apps because these are singular, not per-product. Each maps to a real owner today.

| Shared system | Single source of truth | Status |
|---|---|---|
| Identity / session / SSO | Supabase session + `lib/auth/*`, `lib/supabase/*` | ✅ one session powers every module |
| Authorization / RBAC | `canAccess` predicates in [module-registry.ts](../lib/platform/module-registry.ts) + RLS | ✅ gate is declared once, per module |
| Step-up auth (WebAuthn/MFA/PIN) | migrations `0056`–`0058`, `lib/security/*` | ✅ |
| Navigation | [lib/navigation/registry.ts](../lib/navigation/registry.ts) + `getModuleNav()` | ✅ derived from the module registry |
| Search | [lib/search/index.ts](../lib/search/index.ts), `app/api/search` | ✅ (cross-module index still deepening) |
| Notifications + Push | `lib/social/notifications`, `lib/push/*`, migs `0013/0018/0042–0047/0059` | ✅ realtime, one pipeline |
| Design system | tokens in `tailwind.config.ts` (guarded by `lib/design-tokens.test.ts`), `lib/theme/theme-mode-client.ts`, `features/ui`, `components` | ✅ one token set; theme default **light** |
| Analytics / events | [lib/analytics/events.ts](../lib/analytics/events.ts), `lib/notify.ts` | ✅ |
| Observability | [lib/observability/*](../lib/observability/diagnostics.ts) (diagnostics, memory-pressure, log-error) | ✅ |
| Localization | `lib/i18n/*` (load-bearing; export/import pipeline) | ✅ coverage measured, never declared |
| Payments / entitlements | `lib/paystack/*`, `lib/monetization/*`, `app/api/billing` | ✅ one subscription unlocks Pro everywhere |
| Feature flags / runtime config | [lib/platform/flags.ts](../lib/platform/flags.ts) + `flags-store.ts`, migration `0091_feature_flags.sql`, admin "Feature flags" section | ✅ declared in code, state in DB; kill switch + % rollout + plan gate; 0 client cost when off. **Client-readable** via `GET /api/flags` + `useFlag()` (opt-in, so no per-page cost until a component reads a flag) |
| Experiments (A/B) | [lib/platform/experiments.ts](../lib/platform/experiments.ts) + `experiments-store.ts`, migration `0092_experiments.sql`, admin "Experiments" section | ✅ deterministic assignment (reuses `bucketOf`); exposure logged through the unified `events` pipeline; pause + ship-the-winner overrides |
| Communication (events + integrations) | [event-bus.ts](../lib/platform/event-bus.ts) + [domain-events.ts](../lib/platform/domain-events.ts) + [integration-registry.ts](../lib/platform/integration-registry.ts), admin "Communication" section | ✅ typed in-process event bus; domain-event contracts; a catalogue of every comms surface (REST/realtime/webhooks/workflows), broker + mesh honestly `planned` |
| Audit log | migration `0053_security_audit_log.sql` | ✅ |
| Developer platform / API | `lib/sdk/*`, `app/api/v1`, `app/api/keys` | ✅ |
| Offline / PWA | `lib/pwa/*`, `lib/offline/*`, `app/manifest.ts`, `sw` | ✅ |

**Rule:** a new product does not create a second identity, a second design token
set, a second notification pipeline, or a second nav. It *inherits* the spine. If
the spine is missing something the product needs, extend the spine — don't fork it.

---

## Article III — The Platform Kernel

The kernel is the module registry plus the shared services above. **Adding a product
is one entry** in [lib/platform/modules.ts](../lib/platform/modules.ts); nav, RBAC
gating, the launcher, and search derive from it. Nothing else changes to surface a
product. This *is* the Feature/Workspace/Product Registry the brief asks for — it
already exists; it is not to be rebuilt.

The kernel is deliberately dependency-light (types + pure predicates) so it imports
safely into both Server Components (RBAC) and Client Components (nav) without pulling
weight into any bundle.

**The kernel describes itself.** The brief's "System Registries" and "Backend
Foundation" lists are materialised as honest catalogues that point at real code:
[registries.ts](../lib/platform/registries.ts) (the Registry of Registries — every
registry → its source-of-truth file + status), [services.ts](../lib/platform/services.ts)
(the Service Registry — every named gateway → the module that provides it), and
[events-registry.ts](../lib/platform/events-registry.ts) (the Event Registry — the
single source of `EventType`). They are **catalogues of what exists**, not new
abstractions: a `live` entry must point at a file that exists, a genuinely-absent
capability (the event bus) is marked `planned`, and `platform-catalog.test.ts`
enforces both so the map can't drift into fiction. All three are surfaced at
`/admin` → **Platform**.

---

## Article IV — The Module Contract

Every module (product) obeys [ARCHITECTURE.md](./ARCHITECTURE.md) "The module contract":

1. **Registers itself** — one entry in `lib/platform/modules.ts`.
2. **Owns a route subtree** `app/<module>/…` and a feature folder.
3. **Exposes a public barrel only** — siblings import that, never internals.
4. **Talks to other modules only through Platform Core** — no cross-module folder
   imports, no reading another module's tables.
5. **Is lazy on the client** — heavy surfaces mount via `next/dynamic`.

**Enforced by:** `no-restricted-imports` makes importing another module's
`internal/**` a lint error; the dependency arrow points one way (modules → core, never
core → module).

---

## Article V — Enforcement & CI gates

The law is only as real as its gate. Current gates:

- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build` — necessary,
  **not sufficient** (Invariant I.6).
- `npm run analyze` — per-route First-Load JS; over budget = a regression to explain.
- `lib/content/reality-ledger.test.ts` — every claimable product has a proving route.
- Migrations carry their own RLS policies; the service-role key is server-only.
- Performance + Security review gates are **mandatory** before shipping user-facing
  or auth/data changes.

**Amendment to enforcement:** when a rule bites in production, the fix is not "be more
careful" — it is a new gate that would have caught it. Every scar becomes a test.

---

## Article VI — The Gap Ledger (honest)

The brief names capabilities this repo does **not** yet have. Recorded here in build
order rather than fabricated as done:

| Capability | Reality today | Proposed home |
|---|---|---|
| ~~**Runtime feature flags / config**~~ | ✅ **Shipped 2026-07-21.** Proving route: `/admin` → Feature flags. See the spine table above. | Done — `lib/platform/flags.ts` + `feature_flags` (mig `0091`) + admin section + `flags.test.ts`. |
| ~~**Experiment registry (A/B)**~~ | ✅ **Shipped 2026-07-21.** Proving route: `/admin` → Experiments. See the spine table above. | Done — `lib/platform/experiments.ts` + `experiments` (mig `0092`) + exposure via `events` + admin section + `experiments.test.ts`. |
| ~~**Formal event bus / Event Registry**~~ | ✅ **Shipped 2026-07-21.** Proving route: `/admin` → Communication. | Done — typed in-process bus ([event-bus.ts](../lib/platform/event-bus.ts)) over the Domain Event Registry ([domain-events.ts](../lib/platform/domain-events.ts)); a message broker is the documented exit-path, marked `planned` in the Integration Registry. |
| **Native iOS / Android** | **Do not exist.** This is a Next.js **PWA**. The PWA *is* the mobile app today. | A native shell is a separate repo/toolchain decision (Capacitor wrapper vs. true native), not a file in this one. Flagging, not silently implying it exists. |
| **This Constitution as a hard gate** | New today. | A `constitution.test.ts` that asserts the registry/reality-ledger invariants stay wired. |

**Rule:** nothing in this ledger may be described elsewhere in the present tense
until it appears above the ledger with a proving route (Invariant I.3).

---

## Article VII — The AI Development Framework

This document is written partly for a non-human contributor. Every contributor —
human or AI assistant — follows the same loop, and an AI assistant is held to it
*more* strictly, because it is faster at producing plausible duplication.

1. **Understand the architecture first.** Read the codebase before designing. On this
   project the recurring, expensive mistake is rebuilding what exists under another
   name (~27 of 43 "new" services already existed once).
2. **Reuse before you create** — a component, API route, hook, utility, design token,
   or database model. Search first; duplicate only with a stated justification.
3. **If a dependency is missing, complete it:** design → implement → test → document →
   **register** → integrate. "Register" is literal — it means an entry in the relevant
   registry (Article III), so the platform knows the thing exists.
4. **Flag concerns alongside delivery**, never instead of it, and never fabricate to
   fill a gap — a `planned` marker is always better than a fake.

The registries and the governance manifest exist so that steps 2 and 3 are checkable,
not aspirational.

## Article VIII — Architecture Governance

One deployable, strictly isolated modules (a modular monolith with a clean per-module
exit path — [ARCHITECTURE.md](./ARCHITECTURE.md)). Mandatory: API-first,
component-first, modular, loosely coupled, strong cohesion, single responsibility,
progressive enhancement, graceful degradation, version-aware evolution. Shared platform
services (Article II) are **used, never forked**; the dependency arrow is modules → core.

## Article IX — Domain Governance

Each rule below is a row in the governance manifest ([lib/platform/governance.ts](../lib/platform/governance.ts)).

- **Backend:** clear service ownership; `zod` at every external input; RLS per row;
  rate limiting on mutations and the public API; audit logging of sensitive actions;
  health checks. See [SECURITY.md](./SECURITY.md).
- **Frontend:** one design system (no per-module token fork); component reuse;
  accessibility by default (app-wide reduced-motion baseline); responsive; offline-aware
  (PWA); localized (i18n catalogue).
- **Database:** a new table ships its RLS policies in the *same* migration; indexes for
  hot reads; soft-delete/audit where retention matters. No raw SQL; parameterised RPC only.
- **API:** versioned (`/api/v1`); authenticated + authorized; validated; rate-limited;
  consistent response shapes; documented in the API Registry.

## Article X — Testing & Documentation Governance

Pure logic is unit-tested, and **a new guard must be shown able to fail** (the teeth
discipline — see the reality-ledger and platform-catalog suites). `tsc` + lint + tests +
build are necessary, never sufficient (Invariant I.6): UI needs visual/behavioural
verification, error codes need a real request. Every subsystem ships a doc; durable
records mirror to [PROJECT_NOTES.md](./PROJECT_NOTES.md). **End-to-end smoke tests**
exist ([playwright.config.ts](../playwright.config.ts) + `e2e/`, `npm run test:e2e`) —
a thin browser layer over the critical journeys, run separately from the unit gate.
Automated accessibility/performance testing and distributed tracing remain **standards
we hold but have not fully automated** — marked `planned` in the manifest, not claimed.

## Article XI — Change Management & Observability

Risky changes ship behind a **feature flag** (kill switch + rollout, Article II);
product bets are **A/B tested** with logged exposures; both are built and real. Errors
are captured through the observability layer, never silently swallowed. Distributed
tracing and DORA-style engineering metrics (deploy frequency, lead time, change-fail
rate) are `planned` — named here so they are tracked, not implied as existing.

## Article XII — Engineering Intelligence

The governance manifest ([lib/platform/governance.ts](../lib/platform/governance.ts)) is
the **machine-readable form of this Constitution**: every standard → the thing that
enforces it, with an honest `automated` / `manual` / `planned` status, surfaced at
`/admin` → **Platform** and asserted by `governance.test.ts`. "Are we following our own
rules?" is therefore a query with a definite answer, not a matter of memory or vibe —
which is the entire point, on a project whose scar tissue is what "we'll remember" costs.

## Article XIII — Amendment

This document changes by pull request, like code. An amendment must: (a) name the
invariant or article it touches, (b) name the enforcer that keeps it true, and (c) if
it relaxes a rule, state which past incident made the rule and why it's now safe to
relax. Silent relaxation is forbidden — the Reality Ledger and this clause exist
because "we'll remember" has already failed on this project.
