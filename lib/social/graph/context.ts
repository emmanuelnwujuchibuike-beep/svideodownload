import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { canDiscloseEdge, type EdgeKey } from "./edges";

/**
 * Context Engine™ (Feature 19 · Part 15) — one relationship, many contexts.
 *
 * "How are we connected?" answered from the edges that already exist (the
 * catalogue in edges.ts), in ONE parallel read: friend, follows each way, a
 * conversation, accepted collaborations, a confirmed professional connection and
 * its roles, community membership or a paid subscription either way, memories
 * shared, and — only for the person who made them — the viewer's own circles and
 * favourite. A block, mute or restriction is never disclosed to the other side
 * (edges.ts disclosure), and a block wins over everything: blocked people have no
 * context, only the fact the viewer blocked them, and only for the viewer.
 */

type Row = Record<string, unknown>;

export interface RelationshipContext {
  edge: EdgeKey | "follows_you" | "you_follow" | "mutual_follow";
  label: string;
  detail: string | null;
  since: string | null;
}

export interface Relationship {
  contexts: RelationshipContext[];
  /** The viewer blocked the other person (only ever told to the viewer). */
  youBlocked: boolean;
  /** Either side blocked: nothing else is shown. */
  blocked: boolean;
}

export async function relationshipBetween(viewerId: string, otherId: string): Promise<Relationship> {
  if (viewerId === otherId) return { contexts: [], youBlocked: false, blocked: false };
  const db = createAdminClient();
  const [lo, hi] = viewerId < otherId ? [viewerId, otherId] : [otherId, viewerId];
  const both = (a: string, b: string) => `and(${a}.eq.${viewerId},${b}.eq.${otherId}),and(${a}.eq.${otherId},${b}.eq.${viewerId})`;
  const [blocks, friend, follows, conv, collab, pro, mem, memShared, circles, fav] = await Promise.all([
    db.from("blocks").select("blocker_id").or(both("blocker_id", "blocked_id")).limit(2),
    db.from("friendships").select("created_at").eq("user_low", lo).eq("user_high", hi).maybeSingle(),
    db.from("follows").select("follower_id, created_at").or(both("follower_id", "following_id")).limit(2),
    db.from("conversations").select("created_at").eq("user_low", lo).eq("user_high", hi).maybeSingle(),
    db.from("post_collaborators").select("post_id, user_id, invited_by, created_at").eq("status", "accepted").or(both("user_id", "invited_by")).order("created_at").limit(50),
    db.from("pro_connections").select("requester_id, requester_role, addressee_role, custom_label, responded_at, created_at").eq("status", "accepted").or(both("requester_id", "addressee_id")).limit(1),
    db.from("creator_memberships").select("creator_id, member_id, billing, status, joined_at, period_end").or(both("creator_id", "member_id")).limit(2),
    db.from("memory_people").select("memory_id, memories!inner(owner_id, visibility, deleted_at)").eq("user_id", otherId).eq("memories.owner_id", viewerId).is("memories.deleted_at", null).limit(200),
    db.from("circle_members").select("circle_id, added_at, social_circles(name)").eq("owner_id", viewerId).eq("member_id", otherId).limit(20),
    db.from("friend_favorites").select("created_at").eq("user_id", viewerId).eq("friend_id", otherId).maybeSingle(),
  ]);
  const blockRows = (blocks.data ?? []) as Row[];
  const youBlocked = blockRows.some((b) => b.blocker_id === viewerId);
  if (blockRows.length) return { contexts: youBlocked ? [{ edge: "block", label: "You blocked them", detail: null, since: null }] : [], youBlocked, blocked: true };

  const out: RelationshipContext[] = [];
  const push = (c: RelationshipContext, edge: EdgeKey) => {
    // the viewer is a participant of every edge read here; owner-only edges were read for the viewer's own side
    if (canDiscloseEdge(edge, "owner") || canDiscloseEdge(edge, "other-participant")) out.push(c);
  };
  if (friend.data) push({ edge: "friend", label: "Friends", detail: null, since: (friend.data as Row).created_at as string }, "friend");
  const f = (follows.data ?? []) as Row[];
  const iFollow = f.find((x) => x.follower_id === viewerId);
  const theyFollow = f.find((x) => x.follower_id === otherId);
  if (iFollow && theyFollow) push({ edge: "mutual_follow", label: "You follow each other", detail: null, since: [iFollow.created_at, theyFollow.created_at].sort().pop() as string }, "follow");
  else if (iFollow) push({ edge: "you_follow", label: "You follow them", detail: null, since: iFollow.created_at as string }, "follow");
  else if (theyFollow) push({ edge: "follows_you", label: "Follows you", detail: null, since: theyFollow.created_at as string }, "follow");
  if (conv.data) push({ edge: "conversation", label: "You've chatted", detail: null, since: (conv.data as Row).created_at as string }, "conversation");
  const c = (collab.data ?? []) as Row[];
  if (c.length) push({ edge: "collaborator", label: "Collaborators", detail: `${c.length} ${c.length === 1 ? "post" : "posts"} together`, since: c[0]!.created_at as string }, "collaborator");
  const p = ((pro.data ?? []) as Row[])[0];
  if (p) {
    const theirRole = p.requester_id === otherId ? p.requester_role : p.addressee_role;
    push({ edge: "pro_connection", label: "Worked together", detail: (p.custom_label as string | null) ?? String(theirRole ?? "").replace(/_/g, " "), since: (p.responded_at ?? p.created_at) as string }, "pro_connection");
  }
  for (const m of (mem.data ?? []) as Row[]) {
    if (!["active"].includes(m.status as string)) continue;
    const viewerIsCreator = m.creator_id === viewerId;
    const sub = m.billing === "sub";
    const current = !sub || (m.period_end && Date.parse(m.period_end as string) > Date.now());
    if (!current) continue;
    push({ edge: sub ? "subscriber" : "community_member", label: viewerIsCreator ? (sub ? "Subscribes to you" : "In your community") : sub ? "You subscribe" : "You're in their community", detail: null, since: m.joined_at as string }, sub ? "subscriber" : "community_member");
  }
  const shared = (memShared.data ?? []) as Row[];
  if (shared.length) push({ edge: "memory_shared", label: "Shared memories", detail: `${shared.length} ${shared.length === 1 ? "memory" : "memories"}`, since: null }, "memory_shared");
  // owner-only: the viewer's own organising, never shown to the other person
  const circ = (circles.data ?? []) as Row[];
  if (circ.length) push({ edge: "circle_member", label: "In your circles", detail: circ.map((x) => ((x.social_circles as Row | null)?.name as string) ?? "Circle").join(", "), since: (circ[0]!.added_at as string) ?? null }, "circle_member");
  if (fav.data) push({ edge: "favorite", label: "Your favourite", detail: null, since: (fav.data as Row).created_at as string }, "favorite");
  return { contexts: out, youBlocked: false, blocked: false };
}
