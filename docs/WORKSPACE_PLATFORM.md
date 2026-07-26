# Enterprise Workspace Framework

Every present and future Frenzsave product operates as a **workspace** on one
Platform Kernel — sharing infrastructure, evolving independently where it makes
sense, presenting one consistent experience. This document is the human-readable
companion to the machine-readable registry in
[`lib/platform/workspace-platform.ts`](../lib/platform/workspace-platform.ts), kept
honest by
[`workspace-platform.test.ts`](../lib/platform/workspace-platform.test.ts).

## The one position this map is built to hold

> **This is a modular monolith, not a micro-frontend mesh.**

Its workspaces share authentication, design, analytics, observability and policy
**by construction**, and they ship in one deploy. That is a strength — it is why
adding a product is one registry entry rather than standing up a new service — and
the map says so plainly. The brief's "micro-frontend platform / independent
deployment / plugin framework" describes a *different* architecture: a deliberate
scaling exit-path documented in [`docs/INFRA_DECISIONS.md`](./INFRA_DECISIONS.md),
not something pretended into existence here. Shared-platform rows are `live`;
independent-deployment, plugin and partner-extension rows are `planned`.

## The kernel already exists

Per [`docs/CONSTITUTION.md`](./CONSTITUTION.md) Article III, the kernel is real and
this map is a catalogue over it — not a rebuild:

| Layer | Reality | Anchor |
|---|---|---|
| Workspace Registry | Add a product = one entry; nav/RBAC/launcher/search derive from it | `lib/platform/modules.ts` |
| Workspace Contract | The `PlatformModule` shape + Reality-Ledger veracity | `lib/platform/module-registry.ts` |
| Workspace Gateway | Resolve the workspace owning a path; the set a visitor may open | `lib/platform/modules.ts` |
| Platform Shell | One authenticated frame: sidebar, topbar, mobile nav, right rail | `features/app-shell/app-shell.tsx` |
| Navigation Service | Palette, switcher, adaptive nav, search — views over one registry | `lib/navigation/queries.ts` |
| Service Registry | Every shared gateway → its real provider | `lib/platform/services.ts` |
| Admin | Operate every workspace from one dashboard | `app/admin/page.tsx` |

## Registered workspaces

The registered-workspaces view is a **projection of the Product Genome**, not a
second list — a test asserts the two never drift. Whether a workspace may be
*claimed* as real is inherited from its Reality-Ledger veracity, so the framework
can never advertise an environment that does not exist. Today `download` and
`community` are live and claimable; `studio`, `cloud` and `smart` are declared but
`soon`/internal; `admin` is real but deliberately unclaimable (never marketed).

The brief's expansive workspace list (Marketplace, Music, Jobs, Events, Gaming,
Learning, …) is mostly concept-stage in the genome. The framework's job is to make
adding any of them a one-entry change — not to pretend they already exist.

## Lifecycle

A workspace's lifecycle is expressed through real, existing mechanisms:

- **States** — every module declares a maturity (`live`/`beta`/`soon`) and a
  build stage (`live`→`concept`) (`lib/platform/module-registry.ts`).
- **Activation** — feature flags turn a workspace or capability on/off at runtime,
  with rollout %, plan gates and kill switches (`lib/platform/flags.ts`).
- **Configuration** — every runtime-configurable surface + an audited history
  (`lib/platform/config-registry.ts`).
- **Migration** — versioned schema evolution, each table shipping its RLS in the
  same migration (`supabase/migrations`).

A dedicated runtime **lifecycle service** (install / upgrade / deprecate / remove)
is `planned` — in a monolith those are deploy-time concerns, not a runtime service.

## Shared platform vs independent evolution

| Shared (live, by construction) | Independent (planned exit-path) |
|---|---|
| Auth (`lib/auth/request-user.ts`) | Independent deployment |
| Design system (`lib/platform/component-registry.ts`) | Version compatibility |
| Analytics (`lib/analytics/events.ts`) | (module boundaries **are** enforced today |
| Observability (`lib/observability/trace.ts`) |  via `no-restricted-imports` — `.eslintrc.json`) |
| Policies (`lib/platform/permissions.ts`) |  |

## Extensibility & AI

- **Plugin Framework** — entirely `planned`. A permissioned, isolated extension
  runtime is security-sensitive infrastructure that does not exist; no row implies
  it does.
- **AI understanding** — the substrate is genuinely `live`: `AGENTS.md` plus the
  machine-readable registries (`registries.ts`, `services.ts`, `api-registry.ts`,
  `domain-events.ts`) already let an AI enumerate every workspace, service and
  contract from code. A *runtime* assistant that reasons over live workspace state
  is `planned`.

## Workspace communication

Cross-workspace communication runs over the typed in-process event bus
(`lib/platform/event-bus.ts`) and the domain-event contracts — but honestly, the
bus has **zero producers** today (dormant plumbing until a real code path calls
`emit()`). Notifications, search integration and deep links are the communication
paths that are actually live, via the shell and the nav engine.

## Governance

The registry is subject to the constitution's truth rule
([`docs/CONSTITUTION.md`](./CONSTITUTION.md), Article I.3): a `live`/`partial` row
must point at a file that exists, and a `planned` row must name none. The
registered-workspaces view is additionally asserted to mirror the module registry
exactly, and to derive claimability + access tier from the real genome and
predicates. The operator view is the admin **Workspaces** section (under System).
