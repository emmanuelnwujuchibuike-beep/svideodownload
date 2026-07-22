# Frenz — Developer Experience Platform

The permanent engineering-productivity foundation: the standards, docs, SDKs,
generators, registries and AI-assisted-development wiring every contributor and
future team inherits. As with the other platform docs, **the code registries are
the source of truth** and this file explains and links them.

> **Truth rule (shared with `docs/CONSTITUTION.md`):** a `live` entry points at a
> file that exists — `engineering.test.ts` asserts it — so this platform can't
> drift into describing assets that aren't there.

---

## 1. Philosophy

Simple to understand · fast to onboard · easy to discover · consistent to develop
· safe to modify · observable to debug · automated where practical. The measure of
success is how quickly a new contributor (or an AI assistant) can make a correct,
convention-respecting change without asking.

## 2. Engineering Standards

`lib/platform/engineering-standards.ts` is the conventions as **data**: project
structure, naming, TypeScript, formatting, linting, testing, error handling,
comments, dependencies, architecture boundaries, performance and truth. Each names
**how it is enforced** (a tool, a test, a build gate — or "review" when it's
human) and a real reference file, so a standard is never just an assertion. Start
from `AGENTS.md` for the one-screen version.

## 3. Documentation Platform (Knowledge Hub)

The living docs in `docs/` are the Developer Knowledge Hub: `ARCHITECTURE`,
`SECURITY`, `PERFORMANCE`, `CONSTITUTION`, `API`, `INFRASTRUCTURE`, `DESIGN_SYSTEM`,
`MONETIZATION`, `INFRA_DECISIONS`, `FEATURE_FLAGS_AND_EXPERIMENTS`, the RFCs, and
`PROJECT_NOTES` (the running decision log). They are catalogued — with owners — in
the **Engineering Registry** so the map of "where knowledge lives" is itself code.

## 4. Architecture Navigator

`lib/platform/registries.ts` is the **registry of registries**: every
single-source-of-truth list (modules, navigation, flags, experiments, events,
API, components, config, data domains, …) mapped to the real file that governs it.
That, plus `data-domains.ts` (every table → owning domain) and `api-registry.ts`
(every endpoint), is the Architecture Navigator — how a developer or AI answers
"where does X live and who owns it". The admin **Engineering** and **Platform**
sections render it read-only.

## 5. Engineering Toolkit (generators & automation)

The `scripts/*.mjs` generators, run via npm scripts, are the toolkit:
`tokens:generate` (CSS from typed tokens), `design:adoption` (real component
usage), `metrics:engineering` (DORA metrics from git), `content:compile` (DB → static
TS), `i18n:status` (translation coverage), plus icon generation and the data
backfills. Each is catalogued in the Engineering Registry with its command.

## 6. SDK Platform

`lib/sdk` is `@frenzsave/sdk` — a dependency- and framework-free typed client over
the public `/api/v1` surface. One backend, four clients (web, iOS, Android,
desktop): the same import works in-app (`@/lib/sdk`) and, once published,
externally (`@frenzsave/sdk`). See `docs/API.md`.

## 7. AI-Assisted Development

`AGENTS.md` (repo root) is the entry point for AI coding assistants and new
engineers: the golden rules, where things live, how to navigate via the
registries, and what to run before committing. Because the architecture is
described **as data** (registries + standards + data domains), an assistant can
read its true shape rather than guessing — which is what keeps AI-generated code
convention-respecting.

## 8. Engineering Analytics

`lib/platform/engineering-metrics.ts` computes DORA-style delivery metrics
(deployment frequency, change-failure rate, MTTR) from git history — honest
proxies, each labelled — surfaced via `npm run metrics:engineering`. Component
adoption is measured by `design:adoption`. Both are real measurements, never
estimates.

## 9. Admin surface

`/admin → Engineering` (`features/admin/engineering-catalog.tsx`) renders the whole
platform read-only from the registries: the asset catalogue grouped by kind (docs,
generators, SDK, standards, registries) and the engineering standards with their
enforcement.

---

## Gap Ledger (honest)

What the DX brief names that is **not** built, and why — never implied as done:

| Capability | Status | Note |
|---|---|---|
| Scaffold generator (feature/component/route/migration) | planned | Token/content/icon generators exist; a from-scratch feature scaffold is deferred — patterns are documented and copied from a sibling today. |
| Automated release notes | planned | Commits are Conventional; a generator over them is deferred. |
| Standalone SDK npm release + version registry | planned | The SDK is in-repo and versioned with the app. |
| Documentation-usage analytics / developer portal | planned | Docs are Markdown in-repo; a portal with instrumentation is deferred. |
| Local mock-services / one-command seed env | partial | `.env.local` + Supabase; a full mock layer is not built. |

Everything in §§2–9 is live and tested.
