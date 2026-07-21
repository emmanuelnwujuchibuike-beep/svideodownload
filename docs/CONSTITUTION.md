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
| **Formal event bus / Event Registry** | Cross-module comms is direct calls + Supabase realtime. ARCHITECTURE.md says "event-driven where beneficial" — aspirational, unbuilt. | A typed `emit()`/subscriber contract in `lib/platform/events.ts`. Only worth it when a second consumer appears — one publisher, one consumer is just a function call. **Next, if a real second consumer exists.** |
| **Native iOS / Android** | **Do not exist.** This is a Next.js **PWA**. The PWA *is* the mobile app today. | A native shell is a separate repo/toolchain decision (Capacitor wrapper vs. true native), not a file in this one. Flagging, not silently implying it exists. |
| **This Constitution as a hard gate** | New today. | A `constitution.test.ts` that asserts the registry/reality-ledger invariants stay wired. |

**Rule:** nothing in this ledger may be described elsewhere in the present tense
until it appears above the ledger with a proving route (Invariant I.3).

---

## Article VII — Amendment

This document changes by pull request, like code. An amendment must: (a) name the
invariant or article it touches, (b) name the enforcer that keeps it true, and (c) if
it relaxes a rule, state which past incident made the rule and why it's now safe to
relax. Silent relaxation is forbidden — the Reality Ledger and this clause exist
because "we'll remember" has already failed on this project.
