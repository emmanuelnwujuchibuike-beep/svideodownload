# Enterprise Search & Discovery Platform

One intelligent, permission-aware, fast-by-default search and discovery layer
across every Frenzsave surface. This document is the human-readable companion to
the machine-readable registry in
[`lib/platform/search-platform.ts`](../lib/platform/search-platform.ts), which is
the single source of truth and is kept honest by
[`search-platform.test.ts`](../lib/platform/search-platform.test.ts).

## Position: the substrate already exists

The Search brief asks for a Search Gateway, Indexing Service, Discovery Engine,
Recommendation Engine, Autocomplete, Semantic Search, an SEO Service, a Metadata
Generator, a Ranking Service and a Search Registry. **Almost all of it already
exists** and was built for exactly this — so the deliverable here is the honest
*map* over it, not a second implementation. The registry catalogues every part,
points each at the real module that provides it, and marks the genuinely-absent
enterprise pieces `planned` rather than implying they ship today.

The phased plan behind the `planned` rows is
[`DISCOVERY_PLATFORM_RFC.md`](./DISCOVERY_PLATFORM_RFC.md).

## Search philosophy

Search everything · respect permissions · fast by default · relevant first ·
privacy aware · observable. Two rules make this concrete and are enforced in
code:

- **Permission-aware, always.** People/post/message search filters per viewer
  (hidden accounts, blocks, visibility, plan, region). A public content index
  contains *only* public content — the personal plane (progress, bookmarks) is
  deliberately absent, so one visitor's index can never describe another.
- **Fast by default.** The content index is a static chunk built at deploy time:
  it searches client-side at zero latency, offline, on a bad connection. This is
  what keeps search inside the 2-second page budget (`docs/PERFORMANCE.md`).

## What the registry catalogues

| Catalogue | What it maps | Anchor |
|---|---|---|
| Searchable entities | Every object type in search + which index serves it, permission-awareness, indexability | `lib/social/search.ts`, `lib/search/index.ts` |
| Indexes & engines | The retrieval backends (content, social, command, discovery, entity, message) | `lib/search/index.ts`, `lib/navigation/queries.ts` |
| Ranking signals | The signals actually used to order results | `lib/search/index.ts`, `lib/social/*` |
| SEO & AI discovery | Sitemap, robots, veracity-gated structured data, canonicals, hreflang | `app/sitemap.ts`, `lib/discovery/schema.ts` |
| Discovery surfaces | Explore, discover people, ⌘K, suggestions, related links | `features/explore`, `features/friends` |
| Search types | The brief's keyword/semantic/voice/image/… matrix, answered honestly | `lib/platform/search-platform.ts` |

## SEO Intelligence

Every public page carries server-rendered metadata, a canonical URL, hreflang
alternates derived from real translation availability, and structured data. All
JSON-LD is **veracity-gated** (`lib/discovery/schema.ts`) — a false entity
propagates into third-party knowledge bases and outlives the fix — and
serialised through `lib/seo/json-ld.ts`, never raw `JSON.stringify` (raw blocks
over admin-authored data were a stored-XSS vector).

## Honestly planned

Named by the brief, not built — and marked `planned` in the registry, not
implied as done:

- Semantic / vector search and true natural-language understanding (needs
  pgvector + an embedding pipeline; the corpus is small enough that stemmed
  keyword retrieval covers it today).
- Voice, image, video, audio and OCR search.
- Sitemap index + pagination, image and video sitemaps (RFC §6).
- `llms.txt` + entity summaries for AI crawlers (RFC §7).
- Redirect management and search-console-grade, aggregate-only query analytics
  (RFC §5).
- A personalized (learned) recommendation model — discovery is rule-based today
  (freshness + location + graph centrality).

## Governance

The registry is subject to the constitution's truth rule
(`docs/CONSTITUTION.md`, Article I.3): a `live`/`partial` row must point at a
file that exists, and a `planned` row must name no source. The test fails the
build otherwise. The operator view is the admin **Search & SEO** section.
