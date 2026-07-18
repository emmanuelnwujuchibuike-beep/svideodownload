/**
 * Experience Sync Engine™ — impact analysis. Phase 5 (RFC §6, the IMPACT stage).
 *
 * Given a node that changed, find every piece of content that now needs revisiting.
 *
 * This is the payoff for building the Experience Graph in Phase 3. Without it, "what
 * does this change affect?" is answered by grepping and hoping. With it, blast radius
 * is a bounded traversal: the ~148 SEO pages that `illustrate` a capability are found
 * in one hop, not by a person remembering they exist.
 */
import { GRAPH } from "@/lib/content/graph/build";
import type { ExperienceGraph, GraphNode, NodeId } from "@/lib/content/graph/types";

import type { Finding, Severity } from "./detect";

export interface ImpactedNode {
  node: GraphNode;
  /** Hops from the changed node. 1 = directly attached. */
  distance: number;
  /** The path taken, for explaining WHY something is in the blast radius. */
  via: NodeId[];
}

/**
 * Content affected by a change at `nodeId`, breadth-first.
 *
 * Traverses INBOUND edges: the question is "what points at this?", not "what does
 * this point at". An SEO page `illustrates` a capability, so when the capability
 * changes the page is affected — following outbound edges would walk away from
 * everything that depends on it and find nothing.
 *
 * `maxHops` defaults to 2 because relevance decays fast: at 3 hops on this graph
 * almost every node is reachable from almost every other, and a review queue that
 * lists everything is identical to one that lists nothing.
 */
export function impactOf(
  nodeId: NodeId,
  { maxHops = 2, limit = 200 }: { maxHops?: number; limit?: number } = {},
  graph: ExperienceGraph = GRAPH,
): ImpactedNode[] {
  const seen = new Set<NodeId>([nodeId]);
  const out: ImpactedNode[] = [];
  let frontier: { id: NodeId; via: NodeId[] }[] = [{ id: nodeId, via: [] }];

  for (let hop = 1; hop <= maxHops && frontier.length && out.length < limit; hop++) {
    const next: { id: NodeId; via: NodeId[] }[] = [];

    for (const current of frontier) {
      for (const edge of graph.in.get(current.id) ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);

        const node = graph.nodes.get(edge.from);
        if (!node) continue;

        const via = [...current.via, current.id];
        out.push({ node, distance: hop, via });
        next.push({ id: edge.from, via });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    frontier = next;
  }

  // Nearest first, then stable by id so reports diff cleanly between runs.
  return out.sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id));
}

/* --------------------------------- reporting --------------------------------- */

export interface SyncReport {
  findings: Finding[];
  /** Blast radius per finding, keyed by finding id. */
  impact: Record<string, ImpactedNode[]>;
  counts: Record<Severity, number>;
  /** True when anything is a factual break — publish must not proceed. */
  blocked: boolean;
}

/**
 * Assemble the review queue: findings, each with what it touches.
 *
 * Grouped by finding rather than by node because the actionable unit is the CAUSE.
 * A person fixes one broken route; they do not fix forty pages individually.
 */
export function buildReport(findings: Finding[], graph: ExperienceGraph = GRAPH): SyncReport {
  const impact: Record<string, ImpactedNode[]> = {};
  const counts: Record<Severity, number> = { "factual-break": 0, stale: 0, cosmetic: 0 };

  for (const finding of findings) {
    counts[finding.severity]++;
    impact[finding.id] = graph.nodes.has(finding.nodeId)
      ? impactOf(finding.nodeId, {}, graph)
      : [];
  }

  return {
    findings,
    impact,
    counts,
    blocked: counts["factual-break"] > 0,
  };
}

/** Human-readable report for the CLI and the admin panel. */
export function formatReport(report: SyncReport): string {
  if (!report.findings.length) return "No drift detected — content matches the product.";

  const lines: string[] = [
    `${report.findings.length} finding(s): ` +
      `${report.counts["factual-break"]} factual-break, ${report.counts.stale} stale, ${report.counts.cosmetic} cosmetic`,
    "",
  ];

  for (const finding of report.findings) {
    const affected = report.impact[finding.id] ?? [];
    lines.push(`[${finding.severity}] ${finding.summary}`);
    lines.push(`   fix: ${finding.remedy}`);
    if (affected.length) {
      const shown = affected.slice(0, 3).map((a) => a.node.title).join(", ");
      const more = affected.length > 3 ? ` (+${affected.length - 3} more)` : "";
      lines.push(`   affects ${affected.length}: ${shown}${more}`);
    }
    lines.push("");
  }

  if (report.blocked) {
    lines.push("PUBLISH BLOCKED — the site currently states something untrue.");
  }
  return lines.join("\n");
}
