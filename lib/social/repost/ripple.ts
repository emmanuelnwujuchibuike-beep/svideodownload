/**
 * Social Ripple™ — how a reel actually spread (Feature 15 · Part 4).
 *
 * "Instead of showing simple repost counts, visualize how a reel spreads."
 *
 * ── This draws a tree that exists ─────────────────────────────────────────
 * Every node is a `reposts` row and every edge is that row's
 * `source_repost_id`. The version of this feature that would be easy to build —
 * a pretty fan-out generated from a repost COUNT — is a picture of nothing, and
 * it is precisely the fabricated social proof this project has declined three
 * times. A reel that two people reposted independently draws two nodes side by
 * side, because that is what happened.
 *
 * ── A missing edge is UNKNOWN, not "direct" ───────────────────────────────
 * Provenance only exists from migration 0116 onward, and even after it a repost
 * made from the profile grid or a search result genuinely has no source. Those
 * rows sit at depth 1 with `provenanceUnknown`, and the layer carries a note
 * saying so. Silently drawing them as "reposted from the creator" would invent
 * a hop that may not have happened — and would make every historical reel look
 * like it spread directly, which is the most flattering possible lie.
 *
 * ── "Community" and "Trending" layers are not built ───────────────────────
 * The brief's ladder ends creator → friend → friend-of-friend → community →
 * trending. The first three are degrees of separation and are real here. There
 * is no communities table in this schema and no trend computation anywhere in
 * this codebase, so those two rungs would be labels over empty sets.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface RippleRow {
  repostId: string;
  reposterId: string;
  /** Display name or handle, already resolved by the caller. */
  name: string;
  avatarUrl: string | null;
  /** The repost this one came through. Null = unknown provenance. */
  sourceRepostId: string | null;
  /** Epoch ms. */
  createdAt: number;
  /** The viewer follows or is friends with this reposter. Drives emphasis, not position. */
  isConnection?: boolean;
}

export interface RippleNode {
  repostId: string;
  reposterId: string;
  name: string;
  avatarUrl: string | null;
  /** 1 = reposted the original, 2 = reposted a repost, and so on. */
  depth: number;
  createdAt: number;
  /** How many reposts cite this one as their source. */
  childCount: number;
  provenanceUnknown: boolean;
  isConnection: boolean;
}

export interface RippleLayer {
  depth: number;
  label: string;
  /** Shown when the layer's honesty needs a caveat. */
  note?: string;
  nodes: RippleNode[];
}

export interface Ripple {
  creator: { id: string; name: string; avatarUrl: string | null };
  layers: RippleLayer[];
  totalReposts: number;
  /** Deepest chain observed. 0 when nobody has reposted it. */
  maxDepth: number;
  /** Rows with no recorded edge at all — reported, never hidden. */
  unknownProvenance: number;
  /**
   * Rows whose edge pointed at a repost outside the fetched set (deleted, or on
   * another page). Distinct from `unknownProvenance`: these DID travel through
   * someone, we just cannot say who.
   */
  untracedParents: number;
  /** The single longest chain, creator-first, for the headline sentence. */
  longestChain: string[];
}

function layerLabel(depth: number): string {
  switch (depth) {
    case 1:
      return "Reposted it";
    case 2:
      return "Reposted from someone above";
    case 3:
      return "Friends of friends of friends";
    default:
      return `${depth} steps from the creator`;
  }
}

/**
 * Build the ripple from a flat set of rows.
 *
 * Breadth-first from the creator outward, with a `placed` set that doubles as
 * cycle protection: a self-referencing FK plus an out-of-order insert could in
 * principle produce A→B→A, and a naive walk would recurse forever on live data
 * that no test fixture would ever contain.
 */
export function buildRipple(
  creator: { id: string; name: string; avatarUrl: string | null },
  rows: readonly RippleRow[],
): Ripple {
  const byId = new Map(rows.map((r) => [r.repostId, r]));
  const childrenOf = new Map<string, RippleRow[]>();
  const roots: RippleRow[] = [];
  let unknownProvenance = 0;
  let untracedParents = 0;

  for (const r of rows) {
    // An edge pointing at a repost we did not fetch (deleted, or outside this
    // page) is as unusable as no edge at all — treat it the same way rather
    // than dropping the row, which would under-count the spread. The two cases
    // are still counted separately, because "found it themselves" and "came
    // through someone we can't name" are different facts.
    const parent = r.sourceRepostId ? byId.get(r.sourceRepostId) : undefined;
    if (!parent || parent.repostId === r.repostId) {
      if (r.sourceRepostId) untracedParents++;
      else unknownProvenance++;
      roots.push(r);
    } else {
      const arr = childrenOf.get(parent.repostId) ?? [];
      arr.push(r);
      childrenOf.set(parent.repostId, arr);
    }
  }

  const byDepth = new Map<number, RippleNode[]>();
  const placed = new Set<string>();
  const parentOf = new Map<string, string>();
  let maxDepth = 0;

  const oldestFirst = (a: RippleRow, b: RippleRow) => a.createdAt - b.createdAt;
  let frontier: RippleRow[] = [...roots].sort(oldestFirst);
  let depth = 1;

  // Outer loop re-seeds from anything the walk could not reach. Without it a
  // cycle (A cites B, B cites A) leaves BOTH rows outside `roots` and they
  // vanish from a picture that still claims to show every repost.
  for (;;) {
    if (frontier.length === 0) {
      const stranded = rows.filter((r) => !placed.has(r.repostId));
      if (stranded.length === 0) break;
      frontier = stranded.sort(oldestFirst);
      depth = 1; // re-seeded as roots: their real parent is unreachable
      for (const s of stranded) if (s.sourceRepostId) untracedParents++;
    }

    const next: RippleRow[] = [];
    const nodes: RippleNode[] = byDepth.get(depth) ?? [];
    const before = placed.size;
    for (const r of frontier) {
      if (placed.has(r.repostId)) continue; // cycle guard
      placed.add(r.repostId);
      const kids = (childrenOf.get(r.repostId) ?? []).filter((k) => !placed.has(k.repostId));
      nodes.push({
        repostId: r.repostId,
        reposterId: r.reposterId,
        name: r.name,
        avatarUrl: r.avatarUrl,
        depth,
        createdAt: r.createdAt,
        childCount: kids.length,
        // Depth 1 means "nothing upstream of this that we can see" — true both
        // for a null edge and for one we failed to resolve.
        provenanceUnknown: depth === 1,
        isConnection: !!r.isConnection,
      });
      for (const k of kids) {
        parentOf.set(k.repostId, r.repostId);
        next.push(k);
      }
    }
    if (placed.size === before) break; // placed nothing — stop rather than spin
    if (nodes.length > 0) {
      nodes.sort((a, b) => a.createdAt - b.createdAt);
      byDepth.set(depth, nodes);
      maxDepth = Math.max(maxDepth, depth);
    }
    frontier = next.sort(oldestFirst);
    depth++;
  }

  const layers: RippleLayer[] = [];
  for (const [d, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    layers.push({
      depth: d,
      label: layerLabel(d),
      // Layer 1 is BY CONSTRUCTION the untraceable layer — every node in it has
      // no reachable parent. Saying so once, here, is what stops the picture
      // implying these people all came straight from the creator.
      note:
        d === 1
          ? "Not traced through another repost — they may have found it from the creator, search or Explore."
          : undefined,
      nodes,
    });
  }

  return {
    creator,
    layers,
    totalReposts: rows.length,
    maxDepth,
    unknownProvenance,
    untracedParents,
    longestChain: longestChain(byDepth, parentOf, creator.name),
  };
}

/** Creator-first names down the deepest branch, for the one-line summary. */
function longestChain(
  byDepth: Map<number, RippleNode[]>,
  parentOf: Map<string, string>,
  creatorName: string,
): string[] {
  let deepest: RippleNode | null = null;
  for (const nodes of byDepth.values()) {
    for (const n of nodes) if (!deepest || n.depth > deepest.depth) deepest = n;
  }
  if (!deepest) return [creatorName];

  const nameById = new Map<string, string>();
  for (const nodes of byDepth.values()) for (const n of nodes) nameById.set(n.repostId, n.name);

  const chain: string[] = [];
  let cursor: string | undefined = deepest.repostId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const name = nameById.get(cursor);
    if (name) chain.unshift(name);
    cursor = parentOf.get(cursor);
  }
  return [creatorName, ...chain];
}
