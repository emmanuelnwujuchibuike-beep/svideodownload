# RFC: Frenzsave Living Content Platform

Status: **ACCEPTED — Phase 1 shipped 2026-07-18. Phases 2–5 open.**
Owner decisions (2026-07-18): start at **Phase 1**; CMS model is **compile-to-static** (§1).
Author: engineering
Date: 2026-07-18
Depends on: `config/seoPages.ts`, `lib/platform/modules.ts`, `lib/seo/*`, migration `0084`
Builds toward: Product Genome™, Experience Graph™, Living Content Engine™, Experience Sync Engine™, Global Content Orchestrator™

---

## 0. TL;DR — what I found before designing

Two of the five named systems **already exist in embryo** in this repo. The design below extends them rather than replacing them.

| Named system | Already exists as | Gap |
|---|---|---|
| Living Content Engine™ | `config/seoPages.ts` (1033 lines) + `lib/seo/seo-pages.ts` — clusters × modifiers generating hundreds of pages, FAQs, metadata and internal links from one typed source | Covers the **downloader vertical only**. No ecosystem/product/tutorial content types. No editorial workflow. |
| Product Genome™ | `lib/platform/modules.ts` — `MODULES[]` with `id, name, tagline, basePath, status, canAccess, nav` | **8 fields where the spec needs ~30.** No capabilities, dependencies, release history, a11y, privacy, SEO, or roadmap. |
| Experience Graph™ | — | Does not exist. `seoPages`, `modules`, `blog` and help content have **zero typed edges** between them. |
| Experience Sync Engine™ | — | Does not exist. Nothing detects that content has drifted from the product. |
| Global Content Orchestrator™ | — | Does not exist. `app/admin` is a single `page.tsx`. |

So the work is **less "build 26 services from zero"** and more **"generalise the engine that already works, then add the graph, the drift detector, and the editorial plane."** That is a much better starting position than the brief assumes.

---

## 1. The architectural crux: authoring plane ≠ render plane

The brief implies a database-backed enterprise CMS. Applied naively that is **directly incompatible** with two hard constraints already established in this project:

- **The 2-second page budget** (owner's #1 rule): cold entry ≤2s, no white/skeleton >1–2s.
- **`/` is static** (commit `e7f25c6`). We already learned the hard way that `searchParams`/`cookies()` un-static a page, and that Suspense does **not** isolate a dynamic API without PPR.

A CMS that reads Postgres at request time would put a network round trip (~290ms local→Supabase, measured) in front of every marketing page and un-static `/`. That trades the project's single most-defended property for editability.

**Resolution — split the planes:**

```
  AUTHORING PLANE (Postgres, dynamic, authenticated, slow is fine)
  ├── drafts, reviews, approvals, comments, versions, translations
  ├── product genome records, graph edges, media registry
  └── audit log, scheduling, review queues
                    │
                    │  COMPILE STEP  (approved rows → typed TS modules)
                    │  `npm run content:compile`
                    ▼
  RENDER PLANE (typed TS in repo, build-time static, 0ms at request)
  ├── config/generated/genome.ts      ← same shape discipline as seoPages.ts
  ├── config/generated/graph.ts
  └── config/generated/content.ts
                    │
                    ▼
            Next.js static render → CDN
```

**Publishing is a build, not a write.** An editor approves in the admin UI; the orchestrator compiles approved rows to typed modules, commits them, and triggers a deploy. This buys us:

- **0ms request-time content cost** — the 2s budget is untouched; `/` stays static.
- **Content is type-checked.** A malformed genome record fails `tsc`, not production.
- **Content is diffable and revertible** in git — a real audit trail for free, on top of the DB one.
- **Content works offline / in the PWA**, which already caches `/`.
- **Preview** is the one dynamic path: `/preview/[token]` renders from the DB, `noindex`, authenticated, and explicitly outside the 2s budget.

This is the single most important decision in this document. Everything else follows from it.

---

## 2. Product Genome™ — schema

Extends the existing `PlatformModule` rather than forking it, so the app shell, RBAC, launcher and search keep working unchanged.

```ts
export interface ProductGenome {
  /* identity — mirrors PlatformModule, stays the join key */
  id: string;                    // "download" | "community" | …
  name: string; shortName: string; tagline: string;
  basePath: string; icon: LucideIcon; accent: string;

  /* ── VERACITY: the Reality Ledger, made structural (see §3) ── */
  veracity: {
    stage: "live" | "beta" | "alpha" | "internal" | "planned" | "concept";
    /** Marketing may state this exists. false ⇒ copy must be future-tense. */
    claimable: boolean;
    /** Route that proves it. Build gate asserts this resolves. */
    provingRoute?: string;
    evidence?: string;           // commit / PR / migration that shipped it
    verifiedAt?: string;         // ISO date of last human confirmation
  };

  purpose: string;
  capabilities: Capability[];    // { id, name, stage, description, provingRoute? }
  features: { core: FeatureRef[]; optional: FeatureRef[] };

  dependencies: string[];        // genome ids this needs
  integrations: Integration[];   // external services
  platforms: Platform[];         // web | pwa | android | ios | extension
  permissions: PermissionRef[];

  learning: { tutorials: ContentRef[]; academy: ContentRef[]; faqs: ContentRef[] };
  developer: { apiRefs: ContentRef[]; guides: ContentRef[] };

  releases: Release[];           // { version, date, changes[], breaking }
  compatibility: CompatRange[];

  accessibility: { wcagLevel: "A"|"AA"|"AAA"; audited?: string; notes: string[] };
  privacy: { dataCollected: string[]; retention: string; policyAnchor: string };
  security: { authRequired: boolean; rlsPolicies: string[]; threatNotes: string[] };
  performance: { budgetMs: number; lcpTargetMs: number; measured?: PerfSample };

  analytics: MetricDef[];
  seo: { title: string; description: string; keywords: string[]; canonical: string };
  structuredData: JsonLdBlock[];

  related: string[];             // genome ids
  workflows: WorkflowRef[];
  roadmap: RoadmapRef[];
}
```

**Design notes.**
`icon` stays a `LucideIcon` (a JS value), which is exactly why the genome must live in **TS, not JSON** — the existing registry already proved this pattern. `capabilities` carry their own `stage`, because a product can be `live` while a named capability inside it is still `planned`; without per-capability veracity the ledger leaks at the feature-card level, which is precisely where it leaked before.

---

## 3. The Reality Ledger, enforced by tests (highest-value item)

Established facts in this project:

- **16 of 25 spec'd products do not exist** (landing Part 1).
- **`components/landing/stats-counter.tsx:15-20` hardcodes `35,000,000+` "Videos Downloaded" and `8,000,000+` "Community Members"** and animates them on scroll so they read as live telemetry. Verified in the working tree today.

That second one is not a style problem. It is a factual claim about the business, presented as measured, on the site's front door — an advertising-claims exposure, and it sits directly against the project's own twice-declined "no fake engagement" rule. Note the contrast with `components/landing/showcase-stats.ts`, which is disciplined about exactly this: it documents its base, scopes it to a decorative phone illustration, and adds only real deltas on top. `stats-counter` has no such scoping — it is presented as real.

**The Genome makes this mechanically enforceable.** Proposed gate, in the vitest suite that already runs in CI:

```ts
// lib/content/reality-ledger.test.ts
it("marketing copy never claims a non-claimable product", () => {
  for (const claim of extractProductClaims(MARKETING_SURFACES)) {
    const g = getGenome(claim.productId);
    expect(g.veracity.claimable, `${claim.surface} claims "${g.name}" exists`).toBe(true);
  }
});

it("every claimable product resolves its proving route", async () => { … });

it("no hardcoded magnitude claim outside an audited stats source", () => {
  // fails on /\d{2,3},?000,?000\+/ in components/landing/** unless sourced
});
```

This converts a discipline problem — one that has already recurred — into a build failure. It is cheap, it is testable today, and it is the piece I would ship first regardless of what else gets built.

---

## 4. Experience Graph™ — model

A typed directed graph. Nodes are content-addressable; edges are semantic, not decorative.

```ts
type NodeKind = "product" | "capability" | "feature" | "tutorial" | "help"
              | "video" | "lesson" | "apiRef" | "industry" | "goal"
              | "workflow" | "community" | "marketplace" | "guide" | "topic" | "seoPage";

type EdgeKind = "teaches" | "documents" | "requires" | "enables" | "supersedes"
              | "comparesTo" | "partOf" | "servesGoal" | "usedIn" | "nextStep"
              | "translationOf" | "illustrates";

interface Edge { from: NodeId; to: NodeId; kind: EdgeKind; weight: number; source: "authored"|"derived"; }
```

**The graph is the internal-linking engine, the recommendation engine, and the sitemap topology at once** — one structure, three products. `lib/seo/seo-pages.ts` already computes internal links imperatively; that logic collapses into a graph traversal.

**Derived edges** are computed at compile time (co-occurrence, shared keywords, embedding similarity) and marked `source: "derived"` so an editor can always tell what a human asserted from what a machine inferred. Derived edges never outrank authored ones.

**Cycle and orphan checks** run in CI: an orphaned tutorial (no `teaches` edge) is a content bug and fails the compile with a warning, not an error.

---

## 5. Living Content Engine™ — generalising what works

`seoPages.ts`'s cluster × modifier model is genuinely good: one typed source fans out to slugs, titles, keywords, H1s, taglines, body copy, benefit cards, FAQs and secondary keywords, with `{brand}`/`{thing}` templating to keep pages unique. **Generalise the pattern, don't rewrite it.**

```
ContentType   (seoPage | productPage | featurePage | tutorial | releaseNote
               | faq | comparison | lesson | apiDoc | helpArticle | section)
    × Template (typed fields + render contract)
    × Source   (genome | graph | authored | derived)
    → CompiledContent (typed, static, linked)
```

Generation is **AI-assisted, human-approved** — drafts land in `content_drafts` with `generated_by`/`model` recorded, and never reach the render plane without an approval row. That is a hard invariant, not a policy: the compiler refuses to emit un-approved content.

---

## 6. Experience Sync Engine™ — drift detection

The engine everything else is for. It answers: *what on the website is now a lie?*

```
TRIGGERS: genome change · migration applied · route added/removed
          · release tagged · scheduled sweep · perf/a11y regression
   │
   ▼
DETECT ── diff genome vN vs vN-1; diff route manifest; diff API surface
   │
   ▼
IMPACT ── graph traversal from changed node → every content node within N hops
   │
   ▼
CLASSIFY ── factual-break (blocks publish) | stale (queue) | cosmetic (batch)
   │
   ▼
PROPOSE ── AI draft per affected node · refresh JSON-LD · refresh links
   │
   ▼
REVIEW ── queue in admin, grouped by product; factual-breaks page the owner
```

**Screenshot refresh** deserves a caution: fully automating it means committing binary churn on every UI tweak, and this repo already has an egress budget and a Supabase 5GB cap that was hit once. Proposal — screenshots are captured on demand into the media registry, deduped by perceptual hash, and only replaced when the hash moves beyond a threshold. Not every build.

---

## 7. Database design (authoring plane)

Migrations `0085`–`0092`, following the existing numbering and RLS conventions.

| Migration | Tables |
|---|---|
| `0085` | `product_genomes`, `genome_capabilities`, `genome_releases`, `genome_versions` |
| `0086` | `graph_nodes`, `graph_edges` (+ `gin` index on node metadata) |
| `0087` | `content_items`, `content_versions`, `content_drafts`, `content_bodies` |
| `0088` | `editorial_workflows`, `workflow_stages`, `reviews`, `approvals`, `editorial_comments` |
| `0089` | `translations`, `locales`, `translation_status` |
| `0090` | `media_assets`, `asset_variants`, `asset_usage` |
| `0091` | `publications`, `schedules`, `compile_runs` |
| `0092` | `content_audit_log`, `sync_findings`, `link_health` |

**Conventions carried over:** every table RLS-enforced; counters denormalized and trigger-maintained; `content_bodies` split from `content_items` so list queries never drag large text; `graph_edges` indexed both directions; audit log append-only with no `UPDATE`/`DELETE` grant.

**Archival:** `content_versions` partitioned by quarter, versions older than 8 quarters rolled to cold storage — version history grows unboundedly and is read approximately never.

---

## 8. Services — honest consolidation

The brief names 26 services. Implemented as 26 deployable units this would be a distributed monolith with 26 failure modes for a site whose content changes a few times a day. **This project is explicitly a modular monolith** (`lib/platform`, `lib/sdk`), and that decision is correct here too.

Proposal: **26 named service modules, 5 deployment boundaries.** Every service in the brief exists, keeps its name, gets its own module, contract and tests — they just don't each get a container.

| Boundary | Absorbs | Why separate |
|---|---|---|
| **Content Core** (in-process) | Registry, Genome, Graph, Metadata, Schema, Linking, Feature Registry, Versioning | Pure functions over typed data; no I/O; must be callable from the compiler |
| **Editorial** (Next route handlers) | Workflow, Approval, Publishing, Scheduling, Localization, Media, Asset Registry | Authenticated, dynamic, latency-tolerant |
| **Generation** (queue worker) | Content Generation, Documentation, Tutorial, Academy, FAQ | Long-running, LLM-bound, retryable — must not block a request |
| **Sync** (cron + worker) | Experience Sync, Search Indexing, Monitoring, Audit | Scheduled, bursty |
| **Analytics** (existing `lib/analytics`) | Analytics | Already exists — extend, don't duplicate |

If a boundary later needs independent scaling, the module contract is already the seam to extract along. This is the reversible choice; 26 containers is not.

---

## 9. Admin platform

`app/admin` is currently one `page.tsx`. Build out as `app/admin/content/*`:

Dashboard · Genome editor (form-generated from the TS types, so the schema can't drift from the UI) · Graph explorer (visual, edge CRUD) · Review queue · Draft editor with side-by-side diff · Media library · Localization matrix · Publish scheduler · Sync findings · Link health · Analytics · Audit log.

"Everything configurable without code changes" holds for **content, structure, metadata, links, scheduling and copy**. It does **not** extend to render templates — a template is code, and a CMS that lets editors author templates becomes an untyped, untestable second codebase. This is the standard, and correct, line.

---

## 10. SEO, AI discovery, accessibility

The graph is the SEO asset. Entity authority comes from a consistent, machine-readable entity model — which is what the Genome *is*. Per-page `@graph` JSON-LD emitted from genome + graph (`Product`, `SoftwareApplication`, `HowTo`, `FAQPage`, `Course`, `BreadcrumbList`), `sameAs` for entity reconciliation, `llms.txt` and a public JSON graph endpoint for AI crawlers.

**Accessibility is a publish gate, not a checklist.** `a11y` validation runs in the workflow (§CONTENT_WORKFLOWS) with axe-core against the rendered preview; failures block approval. Note the existing open finding: `/login` CLS 0.162 (POOR) at `login-collage.tsx:42` — the same gate would have caught that.

---

## 11. What this does *not* solve

Stated plainly, because the brief asks for "billion-user scalability" and it is worth being precise about which parts are real:

- The **render plane genuinely scales to any traffic** — it is static files on a CDN. That claim is safe.
- The **authoring plane serves editors**, of which there will be single digits. Designing it for a billion users would be waste.
- **"Never becomes outdated" is a process guarantee, not a technical one.** The Sync Engine detects drift and proposes fixes; a human still approves. If nobody works the review queue, the site goes stale anyway — with better instrumentation. I'd rather say that now than imply the architecture removes the human loop.
- **Cost:** LLM generation across the full content set is a real recurring line item. Generation is queue-bound and batched partly for this reason.

---

## 12. Sequencing — needs an owner decision

Full scope is a multi-month program; it cannot land in one change, and pretending otherwise would produce 26 stubs instead of a working system. Proposed order, each phase independently shippable and useful on its own:

| Phase | Deliverable | Value standalone |
|---|---|---|
| **1** ✅ | Reality Ledger gate + `veracity` on the existing registry + fix `stats-counter` | Kills a live factual-claims exposure. ~1 change. |
| **2** ✅ | Full Product Genome types + backfill the 6 real modules | Source of truth exists; landing page reads from it |
| **3** ◐ | Experience Graph ✅ + compile step + generalised content engine | Internal linking, sitemap, recommendations unify |
| **4** | Authoring DB + admin + editorial workflow | Editors stop needing engineers |
| **5** | Sync Engine + generation + localization + analytics | The living part |

**My recommendation: Phase 1 now.** It is small, it removes a real exposure on the front door today, it needs no new tables, and it establishes the `veracity` contract every later phase depends on. The landing page is also already the owner's declared current focus, so it lands where attention is.

---

## Appendix B — Phase 1 as shipped (2026-07-18)

**Landed:** `ProductVeracity` on `PlatformModule`; veracity records for all 6 modules;
`lib/content/reality-ledger.ts` (pure, no I/O); `lib/content/reality-ledger.test.ts`
(16 assertions, CI-wired); `stats-counter.tsx` and `platform-showcase.tsx` corrected.

**What the gate found on first run** — three real, live violations:

| Surface | Claimed | Measured | Fix |
|---|---|---|---|
| `stats-counter.tsx:16` | 35,000,000+ videos downloaded | overstated ~4–5 orders of magnitude | Replaced with derived facts |
| `stats-counter.tsx:17` | 8,000,000+ community members | overstated ~4–5 orders of magnitude | Replaced with derived facts |
| `platform-showcase.tsx:25` | "20+ Platforms" | 11 named in registry | Derived from `SHOWCASE_PLATFORMS.length` |

(Exact row counts deliberately omitted — this repo is public. The figures are in the
private working notes; the finding here is the discrepancy, not the absolute number.)

Also corrected: `Frenzsave Smart` carried `status: "beta"` while having **no `/smart`
route** and its only UI surface — `<AssistantWidget />` — commented out of
`app/layout.tsx:236`. Recorded as `stage: "internal", claimable: false`.

**Two findings left open for the owner** (not silently changed):

1. **`/smart` and `/studio` and `/cloud` are dead `basePath`s.** They contribute no
   `nav` entries so the shell is safe today, but anything rendering an app launcher
   from `getModulesFor()` would link to a 404. Either build the routes or drop the
   modules from launcher surfaces.
2. **`modules.ts` tagline still reads "Save video & audio from 20+ platforms."**
   Left as-is because the `generic` extractor is yt-dlp-backed and "20+" may well be
   defensible — but it is currently *unsourced*, and the ledger only scans marketing
   surfaces, not the registry. Worth either sourcing or lowering.

**Detector design note.** The first cut flagged 21 sites, 19 of them noise (CSS
`rgba()`, Tailwind arbitrary values, real plan quotas). It was narrowed to *social
proof only* — a figure offered as evidence of scale or track record. A gate that
cries wolf gets deleted, so precision here is a durability property, not polish.
It also flagged its own changelog until comment-stripping was added; documenting a
past violation must never trip the gate, or authors learn to stop writing down why
a number was wrong.

**Verification:** `tsc --noEmit` clean · 229/229 tests · lint clean · `/` screenshotted
and confirmed rendering `11 / 4 / Free / None`.

---

## Appendix C — Phase 2 as shipped (2026-07-18)

**Landed:** `lib/content/genome/{types,registry,queries}.ts` + 15 tests;
`components/landing/product-grid.tsx`; genome-derived JSON-LD on `/`.
Commit `6b5d45c`.

**Two refinements on §2's sketch, both load-bearing:**

1. **The genome is a separate record keyed by module id**, not extra fields on
   `PlatformModule`. `modules.ts` is imported by client components (nav, launcher,
   RBAC gates); hanging ~30 fields of prose, release history and structured data off
   it would ship all of that into the client bundle of every signed-in page.
2. **The genome is JSON-serializable** — no `LucideIcon`, no functions, contrary to
   §2's first sketch. This is what makes Phase 4 possible: the authoring plane
   compiles Postgres rows into exactly this shape, and a genome holding a JS value
   could never round-trip through a database. Icons stay on `PlatformModule`.

**Population rule:** every field is a verified fact or absent. `studio` and `cloud`
are near-empty on purpose — that emptiness is what stops a content generator, a
feature card or an AI summary from inventing detail. Sparse is information.

**Status is never encoded as prose.** A `purpose` of "Internal: assistant endpoint
backing…" leaked engineering register onto the rendered product grid. Status belongs
in `veracity.stage`, which the badge, the ledger and the compiler can all query; a
sentence prefix is invisible to every one of them. Pinned by a test.

### The mockup conflicts this Phase resolves structurally

`public/main landing page.jpg` shows six product cards, each with a live "Explore"
link. `getClaimableProfiles()` yields two. The grid keeps the mockup's shape and lets
veracity choose the treatment, so the design intent survives without the claim. The
remaining mockup conflicts are listed in Appendix D.

---

## Appendix E — Phase 3 part 1 as shipped (2026-07-18): the Experience Graph

**Landed:** `lib/content/graph/{types,build,traverse}.ts` + 20 tests; `ProductLinks`
in `components/seo/related-links.tsx`. Commit `e43781e`.

**Shape today:** 193 nodes (6 products, 14 capabilities, 13 features, 11 topics,
1 workflow, 148 SEO pages), ~800 edges, of which 44 are authored.

**The gap it closed.** `config/seoPages.ts` and `lib/content/genome` were disjoint —
148 pages linked only to each other, 6 products linked only to themselves, zero edges
between. Every SEO page now has a crawl path into the product and capabilities it
describes, which is new internal-link surface that did not previously exist.

**Design decisions worth keeping:**

| Decision | Why |
|---|---|
| Sibling edges nameable but **never materialized** | O(n²) per cluster: ~1,600 edges today, ~83,000 at 1,000 pages, to express what two `partOf` edges already imply. `siblingsOf()` derives in two hops; storage stays linear. Pinned by a test. |
| Derived edges marked **and discounted** | An inference must never outrank a human assertion, and an editor must be able to tell them apart. |
| Term-based capability matching, not embeddings | Clusters use different vocabulary for one intent (Facebook "mp3", TikTok "sound"). An editor has to see *why* an edge exists. |
| `relatedFor` defaults to `realOnly` | The Reality Ledger at the link layer — a traversal cannot surface an unbuilt product however it is reached. |
| Cycles fatal, orphans advisory | Breadcrumbs recurse and dependency resolution never terminates on a cycle. An orphan is a content bug, per §4. |
| Existing sibling **rotation kept** in `getRelatedPages` | Its seeded rotation distributes links differently per page — an SEO diversity property that a stable id sort would destroy. Migrate deliberately, not incidentally. |

**Still open in Phase 3:** the compile step (`scripts/content-compile.ts`) and the
generalised multi-type content engine. Both are better done alongside Phase 4's
authoring tables, since the compiler's input shape is those tables.

---

## Appendix D — open conflicts between the landing mockup and the ledger

`public/main landing page.jpg` (owner-supplied, 2026-07-18) conflicts with shipped
Phase 1/2 invariants in three places. **None are resolved; all need an owner call.**

1. **A five-figure stats band** — "10M+ Happy Users · 50M+ Downloads · 20+ Platforms
   Supported · 99.9% Uptime · 4.9★ User Rating". Every one is unsourced, and they are
   *larger* than the 35M/8M figures Phase 1 removed. Building this band as drawn would
   fail `reality-ledger.test.ts` and re-open the exposure that Phase 1 closed.
2. **"Frenzsave AI" as a product name** — the established brand rule is that this
   suite is **Smart**, never "AI" (see the comment on the module entry in
   `modules.ts`). Pinned by a genome test.
3. **"Join millions of users"** in the closing CTA band — same class as (1).

Everything else in the mockup — the layout, the neon/glow treatment, the phone
composition, the trust bar, the creator section, the rewards card, the footer — has
no ledger conflict and can be built exactly as drawn.

---

## Appendix A — decision log

| Decision | Alternative rejected | Why |
|---|---|---|
| Compile to static TS | Request-time DB reads | Protects the 2s budget and `/`'s static render |
| Genome in TS, not JSON | JSON/YAML content files | `icon` is a JS value; TS gives type-checked content |
| Extend `PlatformModule` | New parallel registry | Shell, RBAC, launcher and search already read it |
| 5 deploy boundaries | 26 microservices | Modular monolith is the established, reversible pattern |
| Templates stay code | Editor-authored templates | Untyped second codebase |
| Screenshots on demand + phash | Auto-refresh every build | Egress cap already hit once; binary churn |
| Human approval required to compile | Full auto-publish | Un-reviewed AI copy on the front door |
