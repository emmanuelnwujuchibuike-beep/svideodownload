/**
 * Social Graph™ — the edge catalogue (Feature 18 · Part 17).
 *
 * ── The one decision this file exists to enforce ──────────────────────────
 * There is ONE graph, and Part 17 did not create it. Follows, friendships,
 * friend requests, blocks, mutes and restrictions have existed since
 * migrations 0006/0020/0021/0035/0076, and roughly twenty read surfaces
 * already enforce them. A "Social Graph" table that re-stated those edges
 * would be a second source of truth: two places to add a friend, two places
 * to check a block, and eventually one of them wrong. The consequence of
 * getting that wrong is not a glitch — it is someone a member blocked
 * reappearing in their feed.
 *
 * So this module is a CATALOGUE over the edges that already exist, not a new
 * store. It gives the graph a vocabulary — and it is where a brief's
 * relationship type gets told the truth about whether the platform can
 * actually observe it.
 *
 * ── Disclosure is a property of the edge, not of the screen ───────────────
 * Every edge carries who is allowed to know it exists. `block`, `mute` and
 * `restrict` are `owner-only` for a reason that is easy to get wrong in a UI:
 * a muted creator must never be able to discover they were muted (migration
 * 0035 says so in its own comment). Putting that fact on the edge means a new
 * screen has to actively override it to leak, rather than having to remember
 * to protect it.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export type EdgeKey =
  | "follow"
  | "friend"
  | "friend_request"
  | "favorite"
  | "block"
  | "mute"
  | "restrict"
  | "subscriber"
  | "customer"
  | "collaborator"
  | "community_member"
  | "organization_member";

/** Who is entitled to know this edge exists. */
export type Disclosure =
  /** Anyone may see it (subject to the owner's own privacy settings). */
  | "public"
  /** Only the two people it joins. */
  | "participants"
  /** Only the person who created it. The other side must never learn of it. */
  | "owner-only";

export type Consent =
  /** One side acts alone and no agreement is implied (follow, block). */
  | "one-sided"
  /** Both sides agreed (friendship). */
  | "mutual"
  /** Awaiting an answer. */
  | "pending";

export interface EdgeSpec {
  key: EdgeKey;
  label: string;
  /** The table that IS this edge — null when the platform cannot observe it. */
  table: string | null;
  symmetry: "directed" | "symmetric";
  disclosure: Disclosure;
  consent: Consent;
  status: "live" | "planned";
  /** For `planned`: the concrete thing missing. Never hand-waved. */
  needs?: string;
  blurb: string;
}

export const GRAPH_EDGES: readonly EdgeSpec[] = [
  {
    key: "follow",
    label: "Follow",
    table: "follows",
    symmetry: "directed",
    disclosure: "public",
    consent: "one-sided",
    status: "live",
    blurb: "One-way interest. Needs no permission and implies no relationship.",
  },
  {
    key: "friend",
    label: "Friend",
    table: "friendships",
    symmetry: "symmetric",
    disclosure: "participants",
    consent: "mutual",
    status: "live",
    blurb: "A mutual, agreed connection. The only edge that unlocks friends-only content.",
  },
  {
    key: "friend_request",
    label: "Friend request",
    table: "friend_requests",
    symmetry: "directed",
    disclosure: "participants",
    consent: "pending",
    status: "live",
    blurb: "An offer of friendship, awaiting an answer.",
  },
  {
    key: "favorite",
    label: "Favourite",
    table: "friend_favorites",
    symmetry: "directed",
    disclosure: "owner-only",
    consent: "one-sided",
    status: "live",
    blurb: "A private pin. The person favourited is never told.",
  },
  {
    key: "block",
    label: "Block",
    table: "blocks",
    symmetry: "directed",
    disclosure: "owner-only",
    consent: "one-sided",
    status: "live",
    blurb: "Severs reach in both directions. Never disclosed to the blocked account.",
  },
  {
    key: "mute",
    label: "Mute",
    table: "muted_creators",
    symmetry: "directed",
    disclosure: "owner-only",
    consent: "one-sided",
    status: "live",
    blurb: "Hides someone from your feed while leaving the relationship intact — and unannounced.",
  },
  {
    key: "restrict",
    label: "Restrict",
    table: "user_restrictions",
    symmetry: "directed",
    disclosure: "owner-only",
    consent: "one-sided",
    status: "live",
    blurb: "Limits what someone can do to you, scope by scope, without blocking them.",
  },
  // ── Declared by the brief, not observable today ─────────────────────────
  {
    key: "subscriber",
    label: "Subscriber",
    table: null,
    symmetry: "directed",
    disclosure: "participants",
    consent: "one-sided",
    status: "planned",
    needs: "Recurring creator billing. Membership tiers (0110) describe an offer and link out; nothing records who is paying.",
    blurb: "Someone paying for your membership tier.",
  },
  {
    key: "customer",
    label: "Customer",
    table: null,
    symmetry: "directed",
    disclosure: "participants",
    consent: "one-sided",
    status: "planned",
    needs: "An orders table linking a buyer to a seller. The commerce platform routes payment; it does not yet record the pair.",
    blurb: "Someone who bought from you.",
  },
  {
    key: "collaborator",
    label: "Collaborator",
    table: null,
    symmetry: "symmetric",
    disclosure: "public",
    consent: "mutual",
    status: "planned",
    needs: "Co-authored posts. `posts` carries a single author_id, so there is no second author to read.",
    blurb: "Someone credited alongside you on a post or project.",
  },
  {
    key: "community_member",
    label: "Community member",
    table: null,
    symmetry: "directed",
    disclosure: "public",
    consent: "one-sided",
    status: "planned",
    needs: "Communities. The notification taxonomy reserves the types; no communities table exists.",
    blurb: "Someone in a community you're also in.",
  },
  {
    key: "organization_member",
    label: "Organisation member",
    table: null,
    symmetry: "directed",
    disclosure: "public",
    consent: "mutual",
    status: "planned",
    needs: "Delegated authorisation. `profile_team_members` (0110) is display-only by design — it grants nothing and must not be read as membership.",
    blurb: "Someone who belongs to the same organisation.",
  },
] as const;

const BY_KEY = new Map(GRAPH_EDGES.map((e) => [e.key, e]));

export function graphEdge(key: string): EdgeSpec | undefined {
  return BY_KEY.get(key as EdgeKey);
}

/** The edges backed by a real table today. */
export function liveEdges(): EdgeSpec[] {
  return GRAPH_EDGES.filter((e) => e.status === "live");
}

/** The edges the brief names that the platform genuinely cannot observe yet. */
export function plannedEdges(): EdgeSpec[] {
  return GRAPH_EDGES.filter((e) => e.status !== "live");
}

/**
 * May `viewer` be told this edge exists?
 *
 * The default is NO for anything unrecognised: a new edge type that forgets to
 * register itself is silent rather than public.
 */
export function canDiscloseEdge(key: string, viewer: "owner" | "other-participant" | "public"): boolean {
  const spec = graphEdge(key);
  if (!spec) return false;
  switch (spec.disclosure) {
    case "public":
      return true;
    case "participants":
      return viewer !== "public";
    case "owner-only":
      return viewer === "owner";
    default:
      return false;
  }
}

/**
 * Edges that must never be rendered as a relationship "type" a member picks.
 *
 * Blocking, muting and restricting are ACTIONS with enforcement behind them.
 * Offering them in the same list as "Family" and "Colleague" invites someone to
 * label a person "Blocked" and believe they are protected when nothing was
 * enforced — a safety failure that looks like a working feature.
 */
export const ENFORCEMENT_EDGES: readonly EdgeKey[] = ["block", "mute", "restrict"] as const;

export function isEnforcementEdge(key: string): boolean {
  return (ENFORCEMENT_EDGES as readonly string[]).includes(key);
}
