/**
 * The Enterprise Search & Discovery Platform, described by itself.
 *
 * The Search brief asks for a "Search Registry™ — a centralized registry
 * documenting searchable entities, indexes, ranking rules, metadata,
 * recommendation models, SEO assets, crawler configurations and operational
 * health", plus a Discovery Engine™ and SEO Intelligence™. As with the Design,
 * Engineering and Data platforms before it, the substrate ALREADY EXISTS —
 * deeply — and this file is the honest map over it, not a second implementation:
 *
 *   - the cross-surface content index (`lib/search/index.ts`),
 *   - privacy-aware people/post search (`lib/social/search.ts`),
 *   - the ⌘K command gateway (`lib/navigation/queries.ts`),
 *   - the "discover people" feed (`lib/social/discovery.ts`),
 *   - the Universal Entity Registry + Schema Registry (`lib/discovery/*`),
 *   - sitemap, robots and veracity-gated structured data across the app.
 *
 * So every entry points at the REAL provider of a capability, staged honestly.
 * The enterprise pieces that genuinely do not exist yet — semantic/vector
 * search, voice/image/video/audio/OCR search, a sitemap index, image & video
 * sitemaps, `llms.txt`, redirect management, search-console-grade query
 * analytics — are `planned`, never implied as done. `docs/DISCOVERY_PLATFORM_RFC.md`
 * is the phased plan behind the planned rows.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `search-platform.test.ts`: a `live`/`partial` entry must point at a
 * file that exists on disk; a `planned` entry must not pretend to.
 */

export type PlatformStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a convention/subset rather than the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every catalogue row satisfies, so one teeth check covers all. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: PlatformStatus;
}

/* ───────────────────────────── searchable entities ──────────────────────────
 * The brief's "Global Search" list — every object type that participates in the
 * platform. Each declares which index serves it, whether the results respect
 * per-viewer permissions, and whether the entity is publicly indexable by search
 * engines (has a crawlable page) or is private surface (never indexed).
 */

export interface SearchableEntity extends CatalogueEntry {
  label: string;
  /** The index/engine that serves it — an id in SEARCH_INDEXES. */
  indexId: string;
  /** Results are filtered per viewer (privacy, blocks, plan, region). */
  permissionAware: boolean;
  /** Has a public, crawlable canonical page (participates in SEO). */
  indexable: boolean;
  note?: string;
}

export const SEARCHABLE_ENTITIES: SearchableEntity[] = [
  { id: "people", label: "People & profiles", indexId: "social", source: "lib/social/search.ts", status: "live", permissionAware: true, indexable: true, note: "Hidden/suspended accounts filtered per viewer; public profiles (/u/[handle]) are crawlable." },
  { id: "posts", label: "Posts — video, image, audio", indexId: "social", source: "lib/social/search.ts", status: "live", permissionAware: true, indexable: true, note: "Only status=published, visibility=public are searchable; each has a canonical /p/[id]." },
  { id: "downloaders", label: "Downloader pages", indexId: "content", source: "lib/seo/seo-pages.ts", status: "live", permissionAware: false, indexable: true, note: "The ~148 generated per-platform pages — the SEO backbone." },
  { id: "lessons", label: "Academy lessons", indexId: "content", source: "lib/learning/catalog.ts", status: "live", permissionAware: false, indexable: true },
  { id: "schools", label: "Academy schools", indexId: "content", source: "lib/academy/schools.ts", status: "live", permissionAware: false, indexable: true, note: "Only teachable schools — derived from product veracity, never assumed." },
  { id: "courses", label: "Academy courses", indexId: "content", source: "lib/academy/courses.ts", status: "live", permissionAware: false, indexable: false, note: "Deliberately NOT addressable — a course renders inside its school, so it carries no canonical of its own." },
  { id: "support", label: "Help & Trust articles", indexId: "content", source: "lib/support/articles.ts", status: "live", permissionAware: false, indexable: true, note: "One corpus, two centres; the canonical is derived (articleHref), never assumed /trust." },
  { id: "glossary", label: "Glossary terms", indexId: "content", source: "lib/support/glossary.ts", status: "live", permissionAware: false, indexable: true, note: "Aliases ARE the search terms; emitted as DefinedTerm anchors." },
  { id: "topics", label: "Topic pillars", indexId: "entities", source: "lib/seo/topics.ts", status: "live", permissionAware: false, indexable: true },
  { id: "commands", label: "Commands & destinations", indexId: "command", source: "lib/navigation/registry.ts", status: "live", permissionAware: true, indexable: false, note: "⌘K palette; gated by canAccess/requiresAuth, so a visitor never sees a destination they can't open." },
  { id: "messages", label: "Direct messages", indexId: "messages", source: "app/api/messages/search/route.ts", status: "live", permissionAware: true, indexable: false, note: "Only a conversation's own participants can search it; never crawlable, never in the public index." },
];

/* ──────────────────────────────── indexes ───────────────────────────────────
 * The brief's Indexing Platform + Search Gateway. In a modular monolith an
 * "index" is the module that owns retrieval for a surface, not a hosted cluster —
 * so each row is the real provider, with how it's built and refreshed.
 */

export type IndexKind =
  | "static" // built once at module load, ships as a chunk, zero request latency
  | "db" // queried against Postgres per request, privacy-filtered
  | "graph" // derived from the Experience Graph
  | "derived"; // computed from another registry

export interface SearchIndex extends CatalogueEntry {
  name: string;
  kind: IndexKind;
  /** One line: what it retrieves. */
  capability: string;
  /** How the index stays current. */
  freshness: string;
  note?: string;
}

export const SEARCH_INDEXES: SearchIndex[] = [
  { id: "content", name: "Content index", kind: "static", source: "lib/search/index.ts", status: "live", capability: "Cross-surface index of lessons, schools, courses, support, glossary and downloader pages.", freshness: "Rebuilt every deploy; a static chunk that searches offline at zero latency." },
  { id: "social", name: "Social search", kind: "db", source: "lib/social/search.ts", status: "live", capability: "People and posts (video/image/audio) with per-viewer privacy filtering.", freshness: "Live Postgres reads via the service role; always current." },
  { id: "command", name: "Command gateway", kind: "derived", source: "lib/navigation/queries.ts", status: "live", capability: "⌘K destinations and commands, ranked by keywords and access.", freshness: "Derived from the navigation registry at render." },
  { id: "discovery", name: "Discovery feed", kind: "db", source: "lib/social/discovery.ts", status: "live", capability: "Fresh public media from creators you don't follow, location-aware.", freshness: "Live reads; ranked by recency and shared location." },
  { id: "entities", name: "Universal Entity Registry", kind: "graph", source: "lib/discovery/entities.ts", status: "live", capability: "One addressable, canonical identity per graph node — the SEO/AI-discovery corpus.", freshness: "Derived from the Experience Graph at build time." },
  { id: "messages", name: "Message search", kind: "db", source: "app/api/messages/search/route.ts", status: "live", capability: "Full-text search within a viewer's own conversations.", freshness: "Live reads, scoped to the requesting participant." },
  { id: "semantic", name: "Semantic / vector index", kind: "db", source: "", status: "planned", capability: "Embedding-based retrieval for meaning-level and natural-language search.", freshness: "n/a — planned.", note: "Would need pgvector + an embedding pipeline; the corpus is small enough that stemmed keyword retrieval covers it today (see the content index)." },
];

/* ─────────────────────────────── ranking signals ────────────────────────────
 * The brief's Ranking Service. These are the signals ACTUALLY used, mapped to
 * the code that applies them — not an aspirational ML stack.
 */

export interface RankingSignal extends CatalogueEntry {
  name: string;
  /** Which index it ranks. */
  appliesTo: string;
  description: string;
  note?: string;
}

export const RANKING_SIGNALS: RankingSignal[] = [
  { id: "relevance-tiers", name: "Tiered text relevance", appliesTo: "content", source: "lib/search/index.ts", status: "live", description: "Exact-title > title-prefix > title-substring > keyword > summary, with stemming and a stopword-aware all-terms rule." },
  { id: "kind-weight", name: "Editorial kind weight", appliesTo: "content", source: "lib/search/index.ts", status: "live", description: "A base rank per kind (support > downloader > term > lesson…) so \"download\" surfaces the tool, not a lesson about it." },
  { id: "hot-score", name: "Post hot-score", appliesTo: "social", source: "lib/social/search.ts", status: "live", description: "Posts ordered by the feed's engagement-decay score." },
  { id: "followers", name: "Follower weight", appliesTo: "social", source: "lib/social/search.ts", status: "live", description: "People ranked by follower count before the per-viewer privacy filter." },
  { id: "command-affinity", name: "Command affinity", appliesTo: "command", source: "lib/navigation/queries.ts", status: "live", description: "Palette results ranked by keyword/synonym match and access, not just the visible label." },
  { id: "recency-location", name: "Recency + location proximity", appliesTo: "discovery", source: "lib/social/discovery.ts", status: "live", description: "Fresh media first; creators sharing the viewer's location float to the top." },
  { id: "graph-centrality", name: "Graph centrality & canonical health", appliesTo: "entities", source: "lib/discovery/entities.ts", status: "live", description: "Containment/relationship signals + duplicate-canonical and orphan detection that keep authority from splitting." },
  { id: "trending", name: "Trending model", appliesTo: "discovery", source: "lib/social/feed.ts", status: "live", description: "The admin-tunable hot-score that promotes content into the feed." },
  { id: "personalized-recs", name: "Personalized recommendation model", appliesTo: "discovery", source: "", status: "planned", description: "Per-user learned ranking (collaborative/embedding based).", note: "Today discovery is rule-based (freshness + location + graph). A learned model needs the aggregate interaction store in the RFC's `0089`, which is deliberately not built speculatively." },
];

/* ───────────────────────────── SEO / AI-discovery ───────────────────────────
 * The brief's SEO Platform + SEO Intelligence™ + Google Discoverability. Every
 * row is a real asset the site already emits, or an honest `planned` from the
 * Discovery RFC's later phases.
 */

export type SeoAssetKind = "sitemap" | "robots" | "structured-data" | "metadata" | "ai-discovery";

export interface SeoAsset extends CatalogueEntry {
  name: string;
  kind: SeoAssetKind;
  description: string;
  note?: string;
}

export const SEO_ASSETS: SeoAsset[] = [
  { id: "sitemap", name: "XML sitemap", kind: "sitemap", source: "app/sitemap.ts", status: "live", description: "Downloaders, blog, academy, lessons, support, topics — URLs derived from availability, never hand-listed." },
  { id: "robots", name: "Robots policy", kind: "robots", source: "app/robots.ts", status: "live", description: "Disallows /api and /admin; explicitly ALLOWS named AI crawlers so Frenzsave is described accurately in AI answers." },
  { id: "json-ld", name: "Safe JSON-LD serializer", kind: "structured-data", source: "lib/seo/json-ld.ts", status: "live", description: "Escapes < > & so admin-authored fields can't break out of the script tag — the fix for a real stored-XSS vector." },
  { id: "schema-registry", name: "Schema Registry", kind: "structured-data", source: "lib/discovery/schema.ts", status: "live", description: "One veracity-gated JSON-LD emitter per entity kind; refuses to assert an entity that isn't real." },
  { id: "schema-webapp", name: "WebApplication schema", kind: "structured-data", source: "app/layout.tsx", status: "live", description: "Site-wide organisation/app schema." },
  { id: "schema-downloader", name: "Downloader rich results", kind: "structured-data", source: "app/(marketing)/[downloader]/page.tsx", status: "live", description: "SoftwareApplication + FAQ + Breadcrumb + HowTo on every generated downloader page." },
  { id: "schema-post", name: "Post media schema", kind: "structured-data", source: "app/p/[id]/page.tsx", status: "live", description: "VideoObject / ImageObject with interaction counters on public posts." },
  { id: "schema-profile", name: "Profile schema", kind: "structured-data", source: "app/u/[handle]/page.tsx", status: "live", description: "ProfilePage + Person on public creator profiles." },
  { id: "schema-support", name: "Support article schema", kind: "structured-data", source: "components/support/support-article.tsx", status: "live", description: "Article + Breadcrumb + FAQ on Help and Trust articles." },
  { id: "canonical", name: "Canonical management", kind: "metadata", source: "lib/discovery/entities.ts", status: "live", description: "One canonical per entity, fail-closed for unreal pages, with build-time duplicate detection." },
  { id: "hreflang", name: "Hreflang alternates", kind: "metadata", source: "lib/i18n/alternates.ts", status: "live", description: "Locale alternates derived from real translation availability, with x-default." },
  { id: "sitemap-index", name: "Sitemap index + pagination", kind: "sitemap", source: "", status: "planned", description: "Split the corpus into per-type children paginated at 5k URLs.", note: "The flat sitemap carries ~200 URLs, well under Google's 50k limit — an index would be indirection serving no crawler until the generated pages pass ~10k. RFC §6." },
  { id: "image-sitemap", name: "Image sitemap", kind: "sitemap", source: "", status: "planned", description: "Per-entity imagery for image search eligibility.", note: "Blocked on stably-addressable per-page art: OG cards 404 without Next's content hash. RFC §6 / sitemap.ts." },
  { id: "video-sitemap", name: "Video sitemap", kind: "sitemap", source: "", status: "planned", description: "Lesson/tutorial media with duration + thumbnail for video rich results.", note: "Needs public pages whose primary content is a video; the marketing site has none today. RFC §6." },
  { id: "llms-txt", name: "llms.txt + entity summaries", kind: "ai-discovery", source: "", status: "planned", description: "A curated, machine-readable map of what Frenzsave is and which documents are authoritative.", note: "Cheap, static, increasingly consumed by AI crawlers. RFC §7." },
  { id: "redirects", name: "Redirect management", kind: "metadata", source: "", status: "planned", description: "from_path → to_path with status, so a moved page keeps its authority.", note: "RFC §5 `discovery_redirects`; no page has moved yet to need it." },
];

/* ──────────────────────────── discovery surfaces ────────────────────────────
 * The brief's Discovery Platform + Recommendation Engine — the USER-facing
 * surfaces that turn the indexes above into discovery.
 */

export interface DiscoverySurface extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const DISCOVERY_SURFACES: DiscoverySurface[] = [
  { id: "explore", name: "Explore", source: "features/explore/explore-browser.tsx", status: "live", description: "Browse trending and recommended public media." },
  { id: "discover-people", name: "Discover people", source: "features/friends/discover.tsx", status: "live", description: "A location-aware grid of creators you don't yet follow." },
  { id: "command-centre", name: "Command centre (⌘K)", source: "features/navigation/command-center.tsx", status: "live", description: "Instant navigation and actions across every workspace." },
  { id: "suggestions", name: "Friend suggestions", source: "features/friends/suggestions-launcher.tsx", status: "live", description: "People-you-may-know recommendations." },
  { id: "search-results", name: "Universal search results", source: "features/search/search-results.tsx", status: "live", description: "The /search page over people and posts." },
  { id: "related-links", name: "Related content links", source: "lib/content/graph/traverse.ts", status: "live", description: "Internal links derived from graph traversal (siblingsOf/relatedFor) rather than hand-written — sibling and next-step relations." },
];

/* ─────────────────────────── search types (matrix) ──────────────────────────
 * The brief's SEARCH TYPES section, answered honestly. `live`/`partial` name the
 * code that provides them; the future modes (voice/image/video/audio/OCR) are
 * `planned` with no fabricated source.
 */

export interface SearchCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const SEARCH_CAPABILITIES: SearchCapability[] = [
  { id: "keyword", name: "Keyword search", source: "lib/social/search.ts", status: "live", description: "Term matching across titles, descriptions, categories and handles." },
  { id: "full-text", name: "Full-text search", source: "lib/social/search.ts", status: "live", description: "PostgREST ilike across multiple fields, input-sanitised against filter injection." },
  { id: "instant", name: "Instant / autocomplete", source: "lib/search/index.ts", status: "live", description: "The static content index searches client-side with zero round-trip as you type." },
  { id: "command", name: "Command search", source: "lib/navigation/queries.ts", status: "live", description: "⌘K keyword/synonym matching over destinations and actions." },
  { id: "context-aware", name: "Context-aware search", source: "lib/social/search.ts", status: "live", description: "Results respect identity, privacy, blocks, plan and location." },
  { id: "natural-language", name: "Natural-language search", source: "lib/search/index.ts", status: "partial", description: "Multi-word natural queries work via stemming + a stopword-aware all-terms rule (\"delete my account\").", note: "Lexical, not semantic — true meaning-level NLU needs the planned vector index." },
  { id: "ai-assisted", name: "AI-assisted search", source: "", status: "planned", description: "Query rewriting and answer synthesis over the corpus.", note: "The assistant backend exists (app/api/assistant) but is not wired to search; see the AI Gateway's `partial` status in the Service Registry." },
  { id: "semantic", name: "Semantic search", source: "", status: "planned", description: "Embedding-based meaning-level retrieval." },
  { id: "voice", name: "Voice search", source: "", status: "planned", description: "Spoken-query capture and transcription." },
  { id: "image", name: "Image search", source: "", status: "planned", description: "Query-by-image and visual similarity." },
  { id: "video", name: "Video search", source: "", status: "planned", description: "Search within and across video content." },
  { id: "audio", name: "Audio search", source: "", status: "planned", description: "Search across audio/soundtracks." },
  { id: "ocr", name: "OCR search", source: "", status: "planned", description: "Text extracted from images and frames." },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getSearchableEntities(): SearchableEntity[] {
  return SEARCHABLE_ENTITIES;
}
export function getSearchIndexes(): SearchIndex[] {
  return SEARCH_INDEXES;
}
export function getRankingSignals(): RankingSignal[] {
  return RANKING_SIGNALS;
}
export function getSeoAssets(): SeoAsset[] {
  return SEO_ASSETS;
}
export function getDiscoverySurfaces(): DiscoverySurface[] {
  return DISCOVERY_SURFACES;
}
export function getSearchCapabilities(): SearchCapability[] {
  return SEARCH_CAPABILITIES;
}

export const SEO_ASSET_KINDS: { id: SeoAssetKind; label: string }[] = [
  { id: "sitemap", label: "Sitemaps" },
  { id: "robots", label: "Robots" },
  { id: "structured-data", label: "Structured data" },
  { id: "metadata", label: "Metadata & canonicals" },
  { id: "ai-discovery", label: "AI discovery" },
];

/** Everything that carries a status, for the platform-health summary. */
export function searchPlatformEntries(): CatalogueEntry[] {
  return [
    ...SEARCHABLE_ENTITIES,
    ...SEARCH_INDEXES,
    ...RANKING_SIGNALS,
    ...SEO_ASSETS,
    ...DISCOVERY_SURFACES,
    ...SEARCH_CAPABILITIES,
  ];
}
