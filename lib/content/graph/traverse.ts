/**
 * Experience Graph traversal — the read API.
 *
 * Internal linking, recommendations, breadcrumbs and sitemap topology are all
 * expressed here as queries over one structure, rather than as separate hand-written
 * systems that drift apart. Pure and synchronous, safe during a static render.
 */
import { GRAPH } from "./build";
import type { EdgeKind, ExperienceGraph, GraphEdge, GraphNode, NodeId } from "./types";

/* --------------------------------- lookups ---------------------------------- */

export function getNode(id: NodeId, graph: ExperienceGraph = GRAPH): GraphNode | undefined {
  return graph.nodes.get(id);
}

export function outEdges(id: NodeId, graph: ExperienceGraph = GRAPH): GraphEdge[] {
  return graph.out.get(id) ?? [];
}

export function inEdges(id: NodeId, graph: ExperienceGraph = GRAPH): GraphEdge[] {
  return graph.in.get(id) ?? [];
}

/** Nodes reachable in one hop, optionally filtered to specific edge kinds. */
export function neighbours(
  id: NodeId,
  kinds?: EdgeKind[],
  graph: ExperienceGraph = GRAPH,
): { node: GraphNode; edge: GraphEdge }[] {
  return outEdges(id, graph)
    .filter((e) => !kinds || kinds.includes(e.kind))
    .map((edge) => ({ node: graph.nodes.get(edge.to), edge }))
    .filter((x): x is { node: GraphNode; edge: GraphEdge } => Boolean(x.node));
}

/* ------------------------------ recommendations ------------------------------ */

export interface RelatedOptions {
  /** Cap on results. */
  limit?: number;
  /** Restrict to these node kinds. */
  kinds?: GraphNode["kind"][];
  /** Exclude nodes whose underlying thing does not exist yet. Default true. */
  realOnly?: boolean;
  /** Edge kinds to follow. Default: everything. */
  via?: EdgeKind[];
}

/**
 * Ranked related nodes — the single entry point for "what should we link to here?".
 *
 * Ranking is by edge weight, which already encodes two policies: semantic edge kinds
 * outrank structural ones, and authored edges outrank derived ones (see
 * `EDGE_WEIGHTS` / `DERIVED_DISCOUNT`). Ties break on node id so output is stable
 * across builds — an unstable order would mean every rebuild produces a different
 * page, which is both a diff-noise problem and an SEO one.
 *
 * `realOnly` defaults to true so a recommendation can never point at an unbuilt
 * product. That is the Reality Ledger applied at the link layer.
 */
export function relatedFor(
  id: NodeId,
  options: RelatedOptions = {},
  graph: ExperienceGraph = GRAPH,
): { node: GraphNode; edge: GraphEdge }[] {
  const { limit = 8, kinds, realOnly = true, via } = options;

  const best = new Map<NodeId, { node: GraphNode; edge: GraphEdge }>();
  for (const { node, edge } of neighbours(id, via, graph)) {
    if (node.id === id) continue;
    if (kinds && !kinds.includes(node.kind)) continue;
    if (realOnly && !node.real) continue;
    // Keep only the strongest edge to any given neighbour.
    const existing = best.get(node.id);
    if (!existing || edge.weight > existing.edge.weight) best.set(node.id, { node, edge });
  }

  return [...best.values()]
    .sort((a, b) => b.edge.weight - a.edge.weight || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}

/**
 * Nodes sharing a `partOf` parent with `id` — siblings, derived in two hops.
 *
 * Deliberately computed rather than stored: materializing a symmetric,
 * fully-connected relation costs O(n²) edges per cluster and would dominate the
 * graph (see the note in build.ts). Two hops over precomputed adjacency is cheap,
 * and storage stays linear in the corpus.
 *
 * Results are sorted by id so the order is stable across builds.
 */
export function siblingsOf(
  id: NodeId,
  limit = 8,
  graph: ExperienceGraph = GRAPH,
): GraphNode[] {
  const parents = outEdges(id, graph).filter((e) => e.kind === "partOf");
  const seen = new Map<NodeId, GraphNode>();

  for (const parent of parents) {
    for (const edge of inEdges(parent.to, graph)) {
      if (edge.kind !== "partOf" || edge.from === id) continue;
      const node = graph.nodes.get(edge.from);
      if (node && !seen.has(node.id)) seen.set(node.id, node);
    }
  }

  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}

/* --------------------------------- structure --------------------------------- */

/** Containment chain via `partOf`, nearest parent first. Powers breadcrumbs. */
export function ancestors(id: NodeId, graph: ExperienceGraph = GRAPH): GraphNode[] {
  const chain: GraphNode[] = [];
  const seen = new Set<NodeId>([id]);
  let current = id;

  while (chain.length < 16) {
    const parent = outEdges(current, graph).find((e) => e.kind === "partOf");
    if (!parent || seen.has(parent.to)) break;
    const node = graph.nodes.get(parent.to);
    if (!node) break;
    chain.push(node);
    seen.add(parent.to);
    current = parent.to;
  }
  return chain;
}

/* --------------------------------- integrity --------------------------------- */

export interface GraphIssue {
  kind: "dangling-edge" | "cycle" | "orphan" | "self-edge";
  detail: string;
}

/**
 * Structural problems, returned as data so both the test suite and a future admin
 * "content quality" panel can consume the same check.
 *
 * Orphans are reported but are NOT automatically fatal — per RFC §4 an orphaned
 * content node is a content bug worth surfacing, not a reason to fail a build.
 * The test decides which classes block.
 */
export function auditGraph(graph: ExperienceGraph = GRAPH): GraphIssue[] {
  const issues: GraphIssue[] = [];

  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from)) {
      issues.push({ kind: "dangling-edge", detail: `${edge.from} → ${edge.to} (missing source)` });
    }
    if (!graph.nodes.has(edge.to)) {
      issues.push({ kind: "dangling-edge", detail: `${edge.from} → ${edge.to} (missing target)` });
    }
    if (edge.from === edge.to) {
      issues.push({ kind: "self-edge", detail: `${edge.from} (${edge.kind})` });
    }
  }

  // Cycles in the containment/dependency skeleton. `partOf` and `requires` must be
  // acyclic or breadcrumbs recurse and dependency resolution never terminates.
  // `sibling` and `comparesTo` are symmetric by design and excluded.
  const structural: EdgeKind[] = ["partOf", "requires"];
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<NodeId, number>();

  const visit = (id: NodeId, path: NodeId[]): void => {
    colour.set(id, GREY);
    for (const edge of outEdges(id, graph)) {
      if (!structural.includes(edge.kind)) continue;
      const state = colour.get(edge.to) ?? WHITE;
      if (state === GREY) {
        issues.push({ kind: "cycle", detail: [...path, id, edge.to].join(" → ") });
      } else if (state === WHITE) {
        visit(edge.to, [...path, id]);
      }
    }
    colour.set(id, BLACK);
  };

  for (const id of graph.nodes.keys()) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id, []);
  }

  for (const [id, node] of graph.nodes) {
    if (outEdges(id, graph).length === 0 && inEdges(id, graph).length === 0) {
      issues.push({ kind: "orphan", detail: `${id} (${node.kind}) has no edges` });
    }
  }

  return issues;
}

/** Counts by node kind — used by tests and the admin content-quality view. */
export function graphStats(graph: ExperienceGraph = GRAPH) {
  const byNodeKind: Record<string, number> = {};
  for (const node of graph.nodes.values()) {
    byNodeKind[node.kind] = (byNodeKind[node.kind] ?? 0) + 1;
  }
  const byEdgeKind: Record<string, number> = {};
  for (const edge of graph.edges) {
    byEdgeKind[edge.kind] = (byEdgeKind[edge.kind] ?? 0) + 1;
  }
  return {
    nodes: graph.nodes.size,
    edges: graph.edges.length,
    byNodeKind,
    byEdgeKind,
    authored: graph.edges.filter((e) => e.source === "authored").length,
    derived: graph.edges.filter((e) => e.source === "derived").length,
  };
}
