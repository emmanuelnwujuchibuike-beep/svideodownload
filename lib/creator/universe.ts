/**
 * Creator Universe™ (Feature 15 · Part 9) — a map of the real connections
 * around a creator's work.
 *
 * ── What is on the map ───────────────────────────────────────────────────
 * Only things with a row behind them: the categories they publish in, the
 * sounds their posts use, the collections their work sits in, the discovery
 * surfaces their views actually came from, and their accepted collaborators.
 * Node size is a real magnitude — views, plays, follows — not a design choice.
 * A node nobody can point at a row for does not appear.
 *
 * ── Why the layout is static ─────────────────────────────────────────────
 * A force-directed graph would mean a physics loop running on the main thread
 * for as long as the page is open, which on this project is a straightforward
 * violation of both the battery and the no-idle-runtime posture. So orbits are
 * computed once, deterministically, from the data: ring by node type, angle by
 * index within the ring. Same picture every load, no animation frame after
 * paint, and a reduced-motion viewer sees exactly what everyone else does.
 *
 * ── Determinism matters here ─────────────────────────────────────────────
 * The same inputs must produce the same picture. A creator who opens this
 * twice and sees their universe rearranged learns that it is decoration. So
 * there is no randomness, no jitter, and ties break on a stable sort key.
 *
 * Pure: no React, no Supabase, no clock, no randomness.
 */

export type UniverseNodeKind = "self" | "category" | "sound" | "collection" | "surface" | "collaborator";

export interface UniverseInput {
  /** The creator at the centre. */
  handle: string;
  avatarUrl: string | null;
  followers: number;
  /** Their categories with the views each has earned. */
  categories: { id: string; label: string; views: number }[];
  /** Sounds used by their posts, with play counts (Part 7). */
  sounds: { id: string; title: string; plays: number }[];
  /** Collections containing their work. */
  collections: { id: string; title: string; items: number }[];
  /** Where views came from — post_watch_events.source (Part 8). */
  surfaces: { id: string; label: string; views: number }[];
  /** Accepted collaborators only. */
  collaborators: { id: string; handle: string; avatarUrl: string | null; posts: number }[];
}

export interface UniverseNode {
  id: string;
  kind: UniverseNodeKind;
  label: string;
  /** The magnitude behind the node, in its own units. */
  value: number;
  /** Radius as a fraction of the map's half-width (0 at the centre, 1 at the edge). */
  ring: number;
  /** Degrees clockwise from 12 o'clock. */
  angle: number;
  /** 0-1, relative to the largest node of the same kind — drives dot size. */
  weight: number;
  avatarUrl?: string | null;
  href?: string;
}

export interface UniverseGraph {
  nodes: UniverseNode[];
  /** Every link runs from the centre outward — this is a radial map of one
   *  creator's reach, not a social network diagram between third parties. */
  links: { from: string; to: string }[];
  /** True when nothing but the creator themselves could be plotted. */
  empty: boolean;
}

/** Which ring each kind occupies. Closest orbit = most intrinsic to the work. */
const RING: Record<Exclude<UniverseNodeKind, "self">, number> = {
  category: 0.42,
  sound: 0.62,
  collection: 0.62,
  surface: 0.85,
  collaborator: 0.42,
};

/** How many of each kind make it onto the map. A map with sixty nodes is not a
 *  map. Ordered by magnitude, so what is shown is what matters most. */
const CAP: Record<Exclude<UniverseNodeKind, "self">, number> = {
  category: 6,
  sound: 5,
  collection: 4,
  surface: 6,
  collaborator: 5,
};

function place(
  kind: Exclude<UniverseNodeKind, "self">,
  items: { id: string; label: string; value: number; avatarUrl?: string | null; href?: string }[],
  /** Where this kind's arc starts, so the rings don't all stack at 12 o'clock. */
  startAngle: number,
): UniverseNode[] {
  const shown = [...items]
    // Stable: magnitude first, then id, so equal values never reshuffle.
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, CAP[kind]);
  if (shown.length === 0) return [];

  const max = Math.max(...shown.map((i) => i.value), 1);
  const arc = 360 / Math.max(shown.length, 1);

  return shown.map((item, i) => ({
    id: `${kind}:${item.id}`,
    kind,
    label: item.label,
    value: item.value,
    ring: RING[kind],
    angle: (startAngle + i * arc) % 360,
    weight: Math.max(0.25, item.value / max),
    avatarUrl: item.avatarUrl ?? null,
    href: item.href,
  }));
}

export function buildCreatorUniverse(input: UniverseInput): UniverseGraph {
  const self: UniverseNode = {
    id: "self",
    kind: "self",
    label: `@${input.handle}`,
    value: input.followers,
    ring: 0,
    angle: 0,
    weight: 1,
    avatarUrl: input.avatarUrl,
  };

  const nodes: UniverseNode[] = [
    self,
    // Offsets are chosen so the two kinds sharing a ring interleave rather than
    // overlap: categories and collaborators both sit at 0.42, sounds and
    // collections both at 0.62.
    ...place("category", input.categories.map((c) => ({ id: c.id, label: c.label, value: c.views })), 0),
    ...place(
      "collaborator",
      input.collaborators.map((c) => ({
        id: c.id,
        label: `@${c.handle}`,
        value: c.posts,
        avatarUrl: c.avatarUrl,
        href: `/u/${c.handle}`,
      })),
      30,
    ),
    ...place(
      "sound",
      input.sounds.map((s) => ({ id: s.id, label: s.title, value: s.plays, href: `/sound/${s.id}` })),
      15,
    ),
    ...place(
      "collection",
      input.collections.map((c) => ({ id: c.id, label: c.title, value: c.items })),
      55,
    ),
    ...place("surface", input.surfaces.map((s) => ({ id: s.id, label: s.label, value: s.views })), 25),
  ];

  return {
    nodes,
    links: nodes.filter((n) => n.id !== "self").map((n) => ({ from: "self", to: n.id })),
    empty: nodes.length === 1,
  };
}

/** Cartesian position on a `size` × `size` viewBox, centre-origin. Exported so
 *  the renderer stays geometry-free and this stays testable. */
export function universePoint(node: UniverseNode, size: number): { x: number; y: number } {
  const half = size / 2;
  const rad = ((node.angle - 90) * Math.PI) / 180;
  return {
    x: half + Math.cos(rad) * node.ring * half * 0.86,
    y: half + Math.sin(rad) * node.ring * half * 0.86,
  };
}
