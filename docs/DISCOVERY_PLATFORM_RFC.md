# Enterprise Discovery Platform™ — Architecture RFC

Status: **design, pre-implementation**
Companion to `ACADEMY_RFC.md`. Both sit on one substrate — see §2.

---

## 1. Position

This brief asks for 19 backend services, 16 database domains, a knowledge graph, an entity
registry, topic clusters, and full SEO/AI-discovery coverage.

**The substrate already exists and was built for exactly this.** `lib/content/graph/` is
the Experience Graph™ — a typed directed graph over products, capabilities, features, SEO
pages, topics and workflows. Its `NodeKind` union *already declares* `industry`, `goal`,
`community`, `marketplace`, `apiRef`, `tutorial`, `help`, `video`, `lesson` and `guide`;
its `EdgeKind` union already declares `documents`, `teaches`, `illustrates`, `servesGoal`,
`comparesTo`, `usedIn`, `nextStep`, `supersedes` and `translationOf`. That union was
written ahead of population, deliberately, because adding a kind later breaks every
exhaustive switch that consumes it.

So the Discovery brief's **Universal Entity Registry™** and **Knowledge Authority Engine™**
are not new systems. They are the Experience Graph, populated and published.

### 1.1 Reuse map

| Brief service | Exists as | State |
|---|---|---|
| Knowledge Graph Service | `lib/content/graph/{build,traverse,types}.ts` | live, partially populated |
| Entity Registry Service | `lib/content/genome/registry.ts` (Product Genome) | live |
| Content Relationship Service | graph edges + `getRelatedPages` | live |
| Structured Data Service | `lib/seo/json-ld.ts` + per-page emitters | live |
| Sitemap Service | `app/sitemap.ts` | live, flat |
| Robots Management | `app/robots.ts` | live, minimal |
| Metadata Generation | Next `Metadata` exports + `generateMetadata` | live |
| Localization Service | `0086` `locales`, `translations` | live |
| Audit Service | `0085` `content_audit_log` | live |
| Version history | `0085` `content_versions` | live |
| Content Validation | `lib/content/reality-ledger.ts` + CI tests | live |
| Indexing/Content health Monitor | `0086` `sync_findings`, `link_health` | live |
| Administrative Dashboard | `app/admin/content` | live |
| Analytics | `app/api/vitals` + events pipeline | live |
| Topic Cluster Service | `lib/seo/seo-pages.ts` clusters | partial |

### 1.2 What genuinely does not exist

Entity registry *unification* (one addressable registry across all node kinds) · topic
cluster formalization · canonical management service · internal linking service (derived
from the graph rather than hand-written) · schema registry · image/video sitemaps ·
sitemap index + pagination · redirect management · search-console-grade analytics ·
AI-discovery surfaces (`llms.txt`, entity summaries) · glossary as `DefinedTerm` anchors ·
breadcrumbs from graph containment.

---

## 2. One substrate, two products

The Academy and the Discovery Platform are the **producer and publisher of the same
graph**. This is the single most important decision in either RFC.

```
                    ┌──────────────────────────┐
   Academy  ───────▶│   EXPERIENCE GRAPH       │◀─────── Product Genome
   (produces        │   nodes + typed edges    │         (products, capabilities)
    lesson/help/    │   one addressable        │
    faq/glossary    │   entity registry        │◀─────── SEO page registry
    nodes)          └────────────┬─────────────┘         (~148 downloader pages)
                                 │
                    ┌────────────▼─────────────┐
                    │  DISCOVERY PLATFORM      │
                    │  publishes the graph as: │
                    │  JSON-LD · sitemaps ·    │
                    │  internal links ·        │
                    │  breadcrumbs · clusters  │
                    └──────────────────────────┘
```

Consequences that fall out for free, rather than being built three times:

- **Internal linking stops being hand-written.** It becomes a traversal. `siblingsOf()`
  already derives sibling relations in two hops instead of materializing O(n²) edges.
- **Sitemap topology stops being a flat list.** It becomes containment (`partOf`).
- **Breadcrumbs stop being per-page strings.** They become the same containment walk.
- **JSON-LD stops being per-page hand assembly.** One emitter per node kind.

The graph's own header already states this: *"internal linking, recommendations and sitemap
topology... are three products of one model rather than three hand-written systems."* This
RFC is that sentence executed.

---

## 3. The Reality Ledger applies harder here

`lib/content/genome/queries.ts`'s `productJsonLd()` already filters on veracity, so an
unbuilt product can never be published as a schema.org entity. That rule now generalises to
every node kind.

**Structured data is a machine-readable assertion of fact.** A `Course` entity for a school
teaching an unbuilt product, an `Organization` claim of scale nobody can source, a
`SoftwareApplication` for a concept-stage product — these are worse than bad copy. They
teach Google and AI crawlers a *false entity*, and entity-authority damage outlives the fix
because it propagates into third-party knowledge bases.

The topic-cluster list in the brief includes **AI creativity, Marketplace, Business,
Professional networking, Cloud** — five clusters over products at `concept` stage, plus
messaging/creator-tools/downloads/privacy/security/communities/developer which are real.

**Rule:** a cluster may exist as a *content* cluster (we may write genuinely useful
educational material about video editing as a subject). It may **not** emit product
entities for unbuilt Frenzsave products. Teaching a technique is honest; asserting we ship a
tool that performs it is not. Enforced in `lib/discovery/discovery.test.ts`.

---

## 4. Services

**Reuse (15):** listed in §1.1.

**Build (10):**

```
lib/discovery/
  entities.ts     Universal Entity Registry — one addressable view over all node kinds
  clusters.ts     Topic Cluster Service — cluster definitions + membership from the graph
  canonical.ts    Canonical Management — one canonical per entity, collision-detected
  linking.ts      Internal Linking Service — graph traversal → related-link sets
  schema.ts       Schema Registry — one JSON-LD emitter per node kind, veracity-gated
  sitemaps.ts     Sitemap Service — index, pagination, image + video sitemaps
  redirects.ts    Redirect Management
  breadcrumbs.ts  Containment walk → BreadcrumbList
  ai-discovery.ts llms.txt, entity summaries, machine-readable corpus
  health.ts       Content health + indexing monitor (feeds sync_findings)
  discovery.test.ts
```

Pure functions over typed data, no I/O — the same boundary rule the Reality Ledger and
graph already follow, so all of it stays callable from the content compiler and costs
nothing at request time.

---

## 5. Database

Migration `0089_discovery.sql`. Additive only; no existing table changes shape.

- `discovery_entities` — canonical registry: node_id, kind, canonical_url, title,
  description, veracity_state, locale
- `discovery_relationships` — authored edges (derived edges stay computed, never stored)
- `discovery_clusters` / `discovery_cluster_members`
- `discovery_canonicals` — source_path → canonical_url, with a **unique constraint that
  makes two canonicals for one entity a write error rather than a silent SEO defect**
- `discovery_redirects` — from_path, to_path, status, active
- `discovery_schema_defs` — schema registry versions
- `discovery_health` — per-entity findings (missing description, orphan node, thin content,
  broken internal link)
- `discovery_search_analytics` — impressions, clicks, CTR, position; **aggregate only**
- `discovery_ai_metrics` — AI-crawler discovery trends

Localization, audit and version history reuse `0086`/`0085` — no second copy.

**Privacy:** every analytics table is aggregate. No per-user rows, no raw query strings tied
to identity, no URLs joined to people. The `0087` precedent (durations bucketed, IPs hashed,
no URL/title columns anywhere) is the standard, and it is not relaxed because this is SEO
data. Search analytics about *pages* is safe; search analytics about *people* is a
different product with different consent, and we are not building that.

---

## 6. Sitemaps

Today `app/sitemap.ts` is a flat 48-line list with hand-maintained priorities and
`lastModified: now` on every entry — which tells crawlers everything changed on every build,
i.e. it tells them nothing.

Replaced with:
- **Sitemap index** + per-corpus children (downloaders, blog, academy, help, glossary, docs),
  paginated at 5,000 URLs — well under the 50,000 limit, with headroom for growth.
- **Real `lastModified`** from content version history (`content_versions`), so freshness
  signals are true.
- **Image sitemap** for entity imagery; **video sitemap** for lesson/tutorial media, with
  duration, thumbnail and description — the requirement that makes video eligible for rich
  results at all.
- Priority derived from graph centrality rather than typed by hand.

Robots gains explicit AI-crawler rules and the sitemap-index pointer. `/api/` and `/admin/`
stay disallowed.

---

## 7. AI discovery

- **`/llms.txt`** — a curated, machine-readable map of what Frenzsave is and which
  documents are authoritative. Cheap, static, increasingly consumed by AI crawlers.
- **Entity summaries** — each entity exposes a stable, factual, veracity-gated abstract.
- **Structured-first, human-first at once.** The brief demands both; they are compatible
  because JSON-LD is emitted from the *same record* that renders the prose. Drift between
  machine and human copy is impossible by construction, which is the actual reason to
  generate rather than hand-write.
- `FAQPage`, `HowTo`, `DefinedTerm`, `Course`, `SoftwareApplication`, `BreadcrumbList`,
  `ItemList`, `VideoObject` — all veracity-gated, all via `jsonLd()`, **never raw
  `JSON.stringify`** (four raw blocks were a stored-XSS vector when admin-DB-sourced).

---

## 8. Performance

Discovery work is build-time by design, so it costs zero request-time latency.

Every generated surface is static; sitemaps are generated, not queried per request; the
graph is built once at module load (a few hundred nodes, sub-millisecond) and reused for
every static render. Core Web Vitals work continues under the existing 2-second budget —
`force-static` declared not inferred, no JS-gated LCP elements, no `motion.div` with
`initial={{opacity:0}}` on an LCP candidate.

Crawl efficiency is a real performance concern here: a sitemap index with true
`lastModified` values means crawlers re-fetch what changed instead of everything.

---

## 9. Accessibility

Semantic HTML and heading hierarchy are shared infrastructure with SEO, not a parallel
track — one correct document structure serves screen readers and crawlers identically.
Breadcrumbs render as a real `<nav aria-label>`, not decoration. Metadata is localized;
layouts use logical properties so RTL works without a second stylesheet.

---

## 10. Phasing

1. **Entity Registry** — unify all node kinds into one addressable registry + canonical
   management with collision detection.
2. **Schema Registry** — one veracity-gated JSON-LD emitter per node kind; migrate existing
   hand-assembled blocks onto it.
3. **Internal Linking + Breadcrumbs** — graph traversal replaces hand-written related links.
4. **Topic Clusters** — formalize the 15 clusters, gate the 5 unbuilt ones per §3.
5. **Sitemaps** — index, pagination, real `lastModified`, image + video sitemaps, robots.
6. **AI discovery** — `llms.txt`, entity summaries.
7. **Content health + indexing monitor** — orphan nodes, thin content, broken links,
   missing metadata → `sync_findings`.
8. **Analytics** — `0089`, aggregate-only search and AI-discovery metrics.
9. **Admin** — entity, metadata, cluster, redirect and health management in
   `app/admin/content`.
10. **Localization wiring.**

---

## 11. Decisions register

| Decision | Rationale |
|---|---|
| Academy and Discovery share one graph | They are producer and publisher of the same entities; two graphs = two truths |
| Entity registry = populated Experience Graph | The node/edge unions were already written for this |
| Derived edges computed, never stored | `sibling` is O(n²) per cluster; two-hop derivation is already the pattern |
| All structured data veracity-gated | A false entity propagates into third-party knowledge bases and outlives the fix |
| Content clusters ≠ product entities | Teaching a technique is honest; claiming a tool that performs it is not |
| Unique constraint on canonicals | Makes a duplicate canonical a write error, not a silent ranking defect |
| Sitemap index + true `lastModified` | `now` on every URL every build is a freshness signal that conveys nothing |
| Analytics aggregate-only | Page analytics is safe; joining queries to people is a different product needing consent |
| All JSON-LD via `jsonLd()` | Raw `JSON.stringify` over admin-authored data is stored XSS |
| Build-time, not request-time | Zero cost against the 2-second budget |
