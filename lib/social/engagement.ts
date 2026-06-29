import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Engagement reads (reactions + comments) for the public post page. Writes live
 * in the API routes (auth + RLS). Comment policy + blocks are enforced here and
 * in the comment API so privacy always wins.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface ReactionState {
  liked: boolean;
  saved: boolean;
}

/** The viewer's like/save state for a post (both false when anonymous). */
export async function getViewerReactions(
  postId: string,
  viewerId: string | null,
): Promise<ReactionState> {
  if (!viewerId || !hasSupabase) return { liked: false, saved: false };
  try {
    const { data } = await createAdminClient()
      .from("post_reactions")
      .select("type")
      .eq("user_id", viewerId)
      .eq("post_id", postId);
    const types = new Set(((data ?? []) as { type: string }[]).map((r) => r.type));
    return { liked: types.has("like"), saved: types.has("save") };
  } catch {
    return { liked: false, saved: false };
  }
}

export interface CommentAuthor {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  plan: BillingPlan;
}

export interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  author: CommentAuthor | null;
  canDelete: boolean;
  replies: CommentNode[];
}

interface CommentRow {
  id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  status: string;
  created_at: string;
}

/** Visible comments for a post, threaded one level, with author cards. */
export async function listComments(
  postId: string,
  postPublisherId: string,
  viewerId: string | null,
  isAdmin = false,
): Promise<CommentNode[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("post_comments")
      .select("id, author_id, parent_id, body, status, created_at")
      .eq("post_id", postId)
      .eq("status", "visible")
      .order("created_at", { ascending: true })
      .limit(300);
    const rows = (data as CommentRow[]) ?? [];
    if (rows.length === 0) return [];

    // Batch author cards (profiles + plans), excluding people who block / are
    // blocked by the viewer.
    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    const [{ data: profs }, { data: subs }, blocked] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended").in("id", authorIds),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", authorIds).in("status", ["active", "trialing"]),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(
            authorIds.map((a) => `and(blocker_id.eq.${a},blocked_id.eq.${viewerId})`).join(",") +
              "," +
              authorIds.map((a) => `and(blocker_id.eq.${viewerId},blocked_id.eq.${a})`).join(","),
          )
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);

    const planById = new Map<string, BillingPlan>();
    for (const s of (subs ?? []) as { user_id: string; plan: BillingPlan }[]) planById.set(s.user_id, s.plan);
    const blockedIds = new Set<string>();
    for (const b of (blocked.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blockedIds.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    const authorById = new Map<string, CommentAuthor>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      const id = p.id as string;
      if ((p.is_suspended as boolean) || !p.handle) continue;
      authorById.set(id, {
        id,
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string) ?? null,
        isVerified: (p.is_verified as boolean) ?? false,
        plan: planById.get(id) ?? "free",
      });
    }

    const canDelete = (authorId: string) =>
      isAdmin || viewerId === authorId || viewerId === postPublisherId;

    const toNode = (r: CommentRow): CommentNode => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      author: authorById.get(r.author_id) ?? null,
      canDelete: canDelete(r.author_id),
      replies: [],
    });

    const nodes = new Map<string, CommentNode>();
    const top: CommentNode[] = [];
    for (const r of rows) {
      // Hide comments from blocked users (but keep your own visible).
      if (blockedIds.has(r.author_id) && r.author_id !== viewerId) continue;
      nodes.set(r.id, toNode(r));
    }
    for (const r of rows) {
      const node = nodes.get(r.id);
      if (!node) continue;
      if (r.parent_id && nodes.has(r.parent_id)) nodes.get(r.parent_id)!.replies.push(node);
      else if (!r.parent_id) top.push(node);
    }
    return top;
  } catch {
    return [];
  }
}

export type CommentGate =
  | { ok: true }
  | { ok: false; reason: "off" | "followers" | "blocked" | "unavailable" };

/** Whether `viewerId` may comment on `postId` (comments_policy + blocks). */
export async function canComment(postId: string, viewerId: string): Promise<CommentGate> {
  if (!hasSupabase) return { ok: false, reason: "unavailable" };
  try {
    const db = createAdminClient();
    const { data: post } = await db
      .from("posts")
      .select("publisher_id, status, visibility")
      .eq("id", postId)
      .maybeSingle();
    if (!post || post.status !== "published") return { ok: false, reason: "unavailable" };
    const publisherId = post.publisher_id as string;
    if (publisherId === viewerId) return { ok: true };

    // Block either way → no.
    const { count: blk } = await db
      .from("blocks")
      .select("blocker_id", { head: true, count: "exact" })
      .or(
        `and(blocker_id.eq.${publisherId},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${publisherId})`,
      );
    if ((blk ?? 0) > 0) return { ok: false, reason: "blocked" };

    const { data: priv } = await db
      .from("privacy_settings")
      .select("comments_policy")
      .eq("user_id", publisherId)
      .maybeSingle();
    const policy = (priv?.comments_policy as string) ?? "everyone";
    if (policy === "off") return { ok: false, reason: "off" };
    if (policy === "followers") {
      const { count } = await db
        .from("follows")
        .select("follower_id", { head: true, count: "exact" })
        .eq("follower_id", viewerId)
        .eq("following_id", publisherId);
      if ((count ?? 0) === 0) return { ok: false, reason: "followers" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Lightweight spam heuristics for a comment body. Null = ok, else a reason. */
export function commentSpamReason(body: string): string | null {
  const text = body.trim();
  if (text.length < 1) return "Comment is empty.";
  if (text.length > 1000) return "Comment is too long.";
  const links = (text.match(/https?:\/\//gi) ?? []).length;
  if (links > 2) return "Too many links.";
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length > 12 && letters === letters.toUpperCase()) return "Please don't shout (all caps).";
  if (/(.)\1{9,}/.test(text)) return "Looks like spam.";
  return null;
}
