import { GRAPH } from "@/lib/content/graph/build";
import type { GraphNode, NodeKind } from "@/lib/content/graph/types";
import { SITE_URL } from "@/lib/site";

/**
 * Universal Entity Registry™ — Discovery Platform Phase 1.
 * See `docs/DISCOVERY_PLATFORM_RFC.md` §4.
 *
 * ── This is a VIEW, not a second store ────────────────────────────────────────
 *
 * The brief asks for a registry "describing every Frenzsave product, feature,
 * document, workflow, industry, creator resource and relationship". That registry
 * already exists: it is the Experience Graph, whose node and edge unions were
 * written ahead of population for exactly this purpose.
 *
 * So this module adds the one thing the graph deliberately does not have — a
 * canonical, absolute, addressable identity per node — and nothing else. It stores
 * no titles, no descriptions and no relationships of its own. Every field is read
 * through from the graph, so there is exactly one place to change a title.
 *
 * ── Why canonical identity belongs here and not in the graph ──────────────────
 *
 * The graph's `href` is a route: relative, sometimes absent (a feature is real but
 * has no page of its own). A canonical URL is a different claim — it is the single
 * address that represents this entity to search engines and AI crawlers, and
 * getting it wrong splits ranking signals between duplicates or points authority
 * at a 404. Keeping it separate means the graph stays about MEANING and this stays
 * about ADDRESSING.
 */

export interface Entity {
  /** Graph node id, e.g. `lesson:how-to-save-a-video`. */
  id: string;
  kind: NodeKind;
  title: string;
  /** Absolute canonical URL. Only ever set for entities that have a page. */
  canonical: string | null;
  /**
   * Whether the underlying thing genuinely exists. Mirrors the graph's `real`,
   * which mirrors genome veracity — one derivation, three consumers.
   */
  real: boolean;
  meta: Record<string, string | number | boolean>;
}

/** Kinds that are addressable — i.e. can have a canonical URL at all. */
const ADDRESSABLE: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "product",
  "seoPage",
  "lesson",
  "guide",
  "help",
  "apiRef",
]);

function toEntity(node: GraphNode): Entity {
  /*
    A canonical is claimed only when the node is BOTH addressable and real.
    An unbuilt product may legitimately have an `href` in the graph (its future
    home), but publishing a canonical for it would assert to crawlers that the
    page exists today. Fail-closed: no href, no canonical.
  */
  const addressable = ADDRESSABLE.has(node.kind) && node.real && Boolean(node.href);

  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    canonical: addressable ? absolute(node.href!) : null,
    real: node.real,
    meta: node.meta ?? {},
  };
}

/** Route → absolute URL, with duplicate slashes collapsed. */
export function absolute(href: string): string {
  return `${SITE_URL}${href.startsWith("/") ? href : `/${href}`}`.replace(
    /([^:]\/)\/+/g,
    "$1",
  );
}

/* ----------------------------------- reads ----------------------------------- */

/** Every entity, derived from the graph. */
export function allEntities(): Entity[] {
  return [...GRAPH.nodes.values()].map(toEntity);
}

/** Entities that have a canonical URL — the set sitemaps and JSON-LD may use. */
export function addressableEntities(): Entity[] {
  return allEntities().filter((e) => e.canonical !== null);
}

export function getEntity(id: string): Entity | undefined {
  const node = GRAPH.nodes.get(id);
  return node ? toEntity(node) : undefined;
}

export function entitiesOfKind(kind: NodeKind): Entity[] {
  return allEntities().filter((e) => e.kind === kind);
}

/* ------------------------------ canonical health ------------------------------ */

export interface CanonicalConflict {
  canonical: string;
  entityIds: string[];
}

/**
 * Canonical URLs claimed by more than one entity.
 *
 * This is the check the RFC calls for as a unique constraint, implemented against
 * the derived registry so it fires at build time rather than on write. Two entities
 * sharing a canonical is not a cosmetic problem: search engines pick one, ranking
 * signals split between them, and whichever loses effectively vanishes. It is also
 * completely invisible in the UI, which is why it needs a mechanical check.
 *
 * Currently reachable because a school and its courses all point at the school
 * page — so courses are correctly NOT addressable, and this test is what keeps
 * that decision from being quietly reversed.
 */
export function canonicalConflicts(): CanonicalConflict[] {
  const byUrl = new Map<string, string[]>();

  for (const entity of addressableEntities()) {
    const list = byUrl.get(entity.canonical!) ?? [];
    list.push(entity.id);
    byUrl.set(entity.canonical!, list);
  }

  return [...byUrl.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([canonical, entityIds]) => ({ canonical, entityIds }));
}

/**
 * Entities that have a page but sit outside the graph entirely — no relationship
 * to anything, in either direction.
 *
 * ── Why "no edges at all" and not "no inbound edges" ──────────────────────────
 *
 * The obvious definition is "nothing links to it", i.e. no inbound edges. That
 * was the first implementation and it reported 155 orphans out of 169 addressable
 * entities — essentially every generated downloader page.
 *
 * It was wrong, and checking rather than believing it is what caught it. The
 * graph models MEANING, not hyperlinks: a downloader page carries
 * `seoPage → partOf → topic` and `seoPage → documents → product`, so its edges
 * all point outward by design. Meanwhile the rendered pages genuinely are linked,
 * by `RelatedLinks` between siblings and `DownloaderLinks` from the homepage —
 * neither of which is a graph edge.
 *
 * So the inbound-only definition measured edge direction, not reachability, and
 * would have reported 155 problems that do not exist. A check that cries wolf
 * gets ignored and then deleted, which costs more than never having written it.
 *
 * True hyperlink-level orphan detection needs the rendered link graph as an
 * input. That is a real thing to build; it is not this, and pretending otherwise
 * would make this number worse than useless.
 */
export function orphanEntities(): Entity[] {
  return addressableEntities().filter(
    (e) => (GRAPH.in.get(e.id) ?? []).length === 0 && (GRAPH.out.get(e.id) ?? []).length === 0,
  );
}
