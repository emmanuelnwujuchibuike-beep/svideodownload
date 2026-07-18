/**
 * Experience Graph™ — Phase 3 of the Living Content Platform
 * (docs/LIVING_CONTENT_PLATFORM_RFC.md §4).
 *
 * A typed directed graph over everything Frenzsave knows: products, capabilities,
 * features, SEO pages, topics, workflows and (later) tutorials, lessons and help
 * articles.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *
 * Today the site has two disconnected islands of structured content:
 *
 *   `config/seoPages.ts`   ~200 generated pages, linked only to EACH OTHER
 *                          (`getRelatedPages` = 5 siblings + 2 cross-cluster).
 *   `lib/content/genome`   6 products with capabilities and features, linked to
 *                          nothing outside themselves.
 *
 * There is no edge between them. A page about saving TikTok audio has no relation
 * to the "Audio extraction" capability that performs it, or to the Download product
 * that owns it. The graph is what makes that relation expressible — and once it is,
 * the same structure serves internal linking, recommendations and sitemap topology,
 * which are three products of one model rather than three hand-written systems.
 *
 * Everything here is pure and JSON-serializable, for the same reason the genome is
 * (RFC §1): Phase 4 compiles authored edges out of Postgres into exactly this shape.
 */

/**
 * Node kinds. The full RFC §4 union is declared even where nothing is populated
 * yet — the shape is the contract Phase 4/5 content types slot into, and adding a
 * kind later is a breaking change for every exhaustive switch that consumes it.
 */
export type NodeKind =
  | "product"
  | "capability"
  | "feature"
  | "seoPage"
  | "topic"
  | "workflow"
  | "tutorial"
  | "help"
  | "video"
  | "lesson"
  | "apiRef"
  | "industry"
  | "goal"
  | "community"
  | "marketplace"
  | "guide";

/**
 * Edge kinds. Semantic, not decorative — each answers a different question, and
 * traversals filter on them. `illustrates` is what connects a marketing/SEO page to
 * the capability it demonstrates; `partOf` builds the containment tree the sitemap
 * and breadcrumbs read.
 */
export type EdgeKind =
  | "partOf"
  | "requires"
  | "enables"
  | "teaches"
  | "documents"
  | "illustrates"
  | "comparesTo"
  | "servesGoal"
  | "usedIn"
  | "nextStep"
  | "supersedes"
  | "translationOf"
  /**
   * Nameable but NEVER materialized. Two nodes under the same `partOf` parent are
   * siblings by definition; storing that symmetric relation costs O(n²) edges per
   * cluster and would dominate the graph. Use `siblingsOf()`, which derives it in
   * two hops. Pinned by a test that asserts no edge of this kind exists.
   */
  | "sibling";

/**
 * Provenance. `authored` is a human assertion; `derived` was inferred at compile
 * time (shared keywords, co-occurrence, containment).
 *
 * Kept explicit so an editor can always tell what a person claimed from what a
 * machine guessed — and so derived edges can be recomputed and thrown away without
 * destroying authored intent. Derived edges never outrank authored ones (see
 * `EDGE_WEIGHTS` and `relatedFor`).
 */
export type EdgeSource = "authored" | "derived";

export type NodeId = string;

export interface GraphNode {
  /** `${kind}:${localId}` — globally unique and human-readable in test output. */
  id: NodeId;
  kind: NodeKind;
  title: string;
  /** Route, when this node is something a visitor can open. */
  href?: string;
  /** Whether the underlying thing genuinely exists (mirrors genome veracity). */
  real: boolean;
  /** Free-form, kind-specific. Stays JSON-serializable. */
  meta?: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  kind: EdgeKind;
  /** Relative strength for ranking traversal results. Higher wins. */
  weight: number;
  source: EdgeSource;
}

export interface ExperienceGraph {
  nodes: Map<NodeId, GraphNode>;
  edges: GraphEdge[];
  /** Adjacency, precomputed once — traversals are hot on static builds. */
  out: Map<NodeId, GraphEdge[]>;
  in: Map<NodeId, GraphEdge[]>;
}

/**
 * Default weights by edge kind. A hand-authored `partOf` should always outrank a
 * derived keyword match, so authored kinds sit above the derived ones and
 * `buildGraph` additionally discounts anything marked `derived`.
 */
export const EDGE_WEIGHTS: Record<EdgeKind, number> = {
  partOf: 10,
  requires: 9,
  teaches: 8,
  documents: 8,
  enables: 7,
  nextStep: 7,
  illustrates: 6,
  servesGoal: 6,
  comparesTo: 5,
  usedIn: 5,
  supersedes: 4,
  translationOf: 3,
  sibling: 2,
};

/** Multiplier applied to any edge a machine inferred rather than a human asserted. */
export const DERIVED_DISCOUNT = 0.5;
