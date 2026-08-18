import type { BillingPlan } from "@/lib/monetization/types";
import { flagsOf, isAccountVisibleTo, relationTo } from "@/lib/social/account-visibility";
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
  /** The Wow flavor picked via the reaction picker (null = the plain Wow). */
  emotion?: string | null;
}

/** The viewer's like/save state for a post (both false when anonymous). */
export async function getViewerReactions(
  postId: string,
  viewerId: string | null,
): Promise<ReactionState> {
  if (!viewerId || !hasSupabase) return { liked: false, saved: false };
  try {
    const rows = await fetchReactionRows(createAdminClient(), viewerId, [postId]);
    const types = new Set(rows.map((r) => r.type));
    return {
      liked: types.has("like"),
      saved: types.has("save"),
      emotion: rows.find((r) => r.type === "like")?.emotion ?? null,
    };
  } catch {
    return { liked: false, saved: false };
  }
}

/**
 * Reads post_reactions rows, tolerant of migration 0033 (the `emotion`
 * column) not being applied yet — a 3-column select that 42703s would
 * otherwise silently blank out EVERY viewer's like/save state, not just the
 * emotion. Shared by the post page and the home/reels feed batch queries.
 */
export async function fetchReactionRows(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string,
  postIds: string[],
): Promise<{ post_id: string; type: string; emotion: string | null }[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await db
    .from("post_reactions")
    .select("post_id, type, emotion")
    .eq("user_id", viewerId)
    .in("post_id", postIds);
  if (!error) return (data ?? []) as { post_id: string; type: string; emotion: string | null }[];
  if (error.code !== "42703") return [];
  const fallback = await db.from("post_reactions").select("post_id, type").eq("user_id", viewerId).in("post_id", postIds);
  return ((fallback.data ?? []) as { post_id: string; type: string }[]).map((r) => ({ ...r, emotion: null }));
}

export interface CommentAuthor {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  plan: BillingPlan;
  /** Viewer and this author are mutual friends — powers "Friends First" sort. */
  isFriend: boolean;
}

export interface CommentReactionCount {
  emoji: string;
  count: number;
}

/** Minimal snapshot of a quoted comment — resolved from the SAME post's
 *  already-fetched rows (never a second query), so a quote can never leak a
 *  comment the viewer wouldn't otherwise be allowed to see on this post. */
export interface QuotedCommentSnapshot {
  id: string;
  author: CommentAuthor | null;
  /** First ~140 chars — a preview, not the full quoted body. */
  bodySnippet: string;
}

export interface CommentLocation {
  lat: number;
  lng: number;
  label: string | null;
}

export interface CommentNode {
  id: string;
  body: string;
  /** Sticker id (see lib/social/stickers) when the comment is a sticker. */
  sticker: string | null;
  /** Attached image URL when the comment carries a picture. */
  imageUrl: string | null;
  /** Voice-note attachment (recorded in-app — see features/social/voice-recorder.tsx). */
  voiceUrl: string | null;
  voiceDurationMs: number | null;
  /** Precomputed amplitude peaks (0-100 ints) — renders instantly, no re-decode. */
  voiceWaveform: number[] | null;
  /** Short video-reply attachment (recorded in-app). */
  videoUrl: string | null;
  videoDurationMs: number | null;
  videoThumbnailUrl: string | null;
  /** Quote Reply (Part 5 tranche 4) — references any comment on this post,
   *  not necessarily the structural parent (parentId). Null if not quoting,
   *  or if the quoted comment was deleted. */
  quotedComment: QuotedCommentSnapshot | null;
  /** Location comment type. */
  location: CommentLocation | null;
  /** Total reactions (any emoji). Kept as `likesCount` for compatibility. */
  likesCount: number;
  viewerLiked: boolean;
  /** Reaction breakdown by emoji, most-used first. */
  reactions: CommentReactionCount[];
  /** The emoji the viewer reacted with, if any. */
  viewerReaction: string | null;
  /** Mood tag id (see comment-meta), if the author set one. */
  mood: string | null;
  pinned: boolean;
  /** Pin category (see lib/social/comment-meta PIN_LABELS), null = unlabelled. */
  pinLabel: string | null;
  pinnedAt: string | null;
  isBest: boolean;
  createdAt: string;
  editedAt: string | null;
  author: CommentAuthor | null;
  canDelete: boolean;
  /** Only the comment's own author may edit (moderators can delete, never
   *  rewrite someone else's words). */
  canEdit: boolean;
  /** The viewer may pin / mark best (post owner or admin). */
  canModerate: boolean;
  replies: CommentNode[];
}

interface CommentRow {
  id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  status: string;
  created_at: string;
  sticker?: string | null;
  image_url?: string | null;
  voice_url?: string | null;
  voice_duration_ms?: number | null;
  voice_waveform?: number[] | null;
  video_url?: string | null;
  video_duration_ms?: number | null;
  video_thumbnail_url?: string | null;
  quoted_comment_id?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_label?: string | null;
  likes_count?: number | null;
  mood?: string | null;
  pinned?: boolean | null;
  pin_label?: string | null;
  pinned_at?: string | null;
  is_best?: boolean | null;
  edited_at?: string | null;
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
    // Prefer the rich columns (sticker/image), but fall back cleanly if the
    // migration hasn't been applied yet so comments never vanish.
    const EXT =
      "id, author_id, parent_id, body, status, created_at, sticker, image_url, likes_count, mood, pinned, pin_label, pinned_at, is_best, edited_at, " +
      "voice_url, voice_duration_ms, voice_waveform, video_url, video_duration_ms, video_thumbnail_url, " +
      "quoted_comment_id, location_lat, location_lng, location_label";
    const BASE = "id, author_id, parent_id, body, status, created_at, likes_count";
    const runQuery = (cols: string) =>
      db
        .from("post_comments")
        .select(cols)
        .eq("post_id", postId)
        .eq("status", "visible")
        .order("created_at", { ascending: true })
        .limit(400);
    const ext = await runQuery(EXT);
    const raw = (ext.error ? (await runQuery(BASE)).data : ext.data) as unknown as CommentRow[] | null;
    const rows = raw ?? [];
    if (rows.length === 0) return [];

    // Reactions per comment (grouped by emoji) + the viewer's own reaction.
    // Falls back to a plain ❤️ tally if the emoji column isn't migrated yet.
    const ids = rows.map((r) => r.id);
    const reactionsByComment = new Map<string, Map<string, number>>();
    const viewerReactionBy = new Map<string, string>();
    const add = (commentId: string, emoji: string) => {
      const m = reactionsByComment.get(commentId) ?? new Map<string, number>();
      m.set(emoji, (m.get(emoji) ?? 0) + 1);
      reactionsByComment.set(commentId, m);
    };
    try {
      const rr = await db.from("comment_reactions").select("comment_id, user_id, emoji").in("comment_id", ids);
      const rdata = (rr.error
        ? (await db.from("comment_reactions").select("comment_id, user_id").in("comment_id", ids)).data
        : rr.data) as unknown as { comment_id: string; user_id: string; emoji?: string }[] | null;
      for (const r of rdata ?? []) {
        const emoji = r.emoji || "❤️";
        add(r.comment_id, emoji);
        if (viewerId && r.user_id === viewerId) viewerReactionBy.set(r.comment_id, emoji);
      }
    } catch {
      /* comment_reactions not migrated yet */
    }

    // Batch author cards (profiles + plans), excluding people who block / are
    // blocked by the viewer.
    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    const [{ data: profs }, { data: subs }, blocked] = await Promise.all([
      db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden").in("id", authorIds),
      db.from("subscriptions").select("user_id, plan, status").in("user_id", authorIds).in("status", ["active", "trialing"]),
      // Fetch only the VIEWER's block edges (bounded) — never one filter per
      // commenter, which would balloon the URL on busy posts.
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);

    // Same bounded, one-shot pattern as blocks above — the viewer's own
    // friendship edges (not one filter per commenter), for "Friends First"
    // sort. Tolerant of the friends migration not being applied: degrades to
    // an empty set rather than failing the whole comment list.
    const friendIds = new Set<string>();
    if (viewerId) {
      try {
        const { data: friendRows } = await db
          .from("friendships")
          .select("user_low, user_high")
          .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`);
        for (const f of (friendRows ?? []) as { user_low: string; user_high: string }[]) {
          friendIds.add(f.user_low === viewerId ? f.user_high : f.user_low);
        }
      } catch {
        /* friendships not migrated yet */
      }
    }

    const planById = new Map<string, BillingPlan>();
    for (const s of (subs ?? []) as { user_id: string; plan: BillingPlan }[]) planById.set(s.user_id, s.plan);
    const blockedIds = new Set<string>();
    for (const b of (blocked.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blockedIds.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    const authorById = new Map<string, CommentAuthor>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) {
      const id = p.id as string;
      if (!p.handle) continue;
      // Reuses the `friendIds` set already gathered above for Friends-First
      // sorting. Since 0082 a hidden commenter is still shown to their friends;
      // strangers don't see the comment at all.
      if (!isAccountVisibleTo(flagsOf(p), relationTo(id, viewerId, friendIds))) continue;
      authorById.set(id, {
        id,
        handle: p.handle as string,
        displayName: (p.display_name as string) || `@${p.handle as string}`,
        avatarUrl: (p.avatar_url as string) ?? null,
        isVerified: (p.is_verified as boolean) ?? false,
        plan: planById.get(id) ?? "free",
        isFriend: friendIds.has(id),
      });
    }

    const canDelete = (authorId: string) =>
      isAdmin || viewerId === authorId || viewerId === postPublisherId;
    const canEdit = (authorId: string) => !!viewerId && viewerId === authorId;
    const canModerate = isAdmin || (!!viewerId && viewerId === postPublisherId);

    // Quote Reply — resolved from the SAME already-fetched `rows`, never a
    // second query, so a quote can only ever reference something the viewer
    // could already see on this post. A quoted comment from a BLOCKED author
    // returns null entirely (not just author: null) — the block hides their
    // comment from rendering directly (see the tree-building loop below);
    // letting the body text leak through someone else's quote of it, even
    // with the identity stripped, would defeat that. Same treatment applies
    // when the quoted author is the viewer's own blocked-by (block is
    // symmetric here, matching canComment's own bidirectional block check).
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const quotedSnapshot = (quotedId: string | null | undefined): QuotedCommentSnapshot | null => {
      if (!quotedId) return null;
      const q = rowById.get(quotedId);
      if (!q) return null;
      if (blockedIds.has(q.author_id) && q.author_id !== viewerId) return null;
      return {
        id: q.id,
        author: authorById.get(q.author_id) ?? null,
        bodySnippet: (q.body || "").slice(0, 140),
      };
    };

    const toNode = (r: CommentRow): CommentNode => {
      const rmap = reactionsByComment.get(r.id);
      const reactions = rmap
        ? [...rmap.entries()].map(([emoji, count]) => ({ emoji, count })).sort((a, b) => b.count - a.count)
        : [];
      const total = reactions.reduce((n, x) => n + x.count, 0);
      const viewerReaction = viewerReactionBy.get(r.id) ?? null;
      return {
        id: r.id,
        body: r.body,
        sticker: r.sticker ?? null,
        imageUrl: r.image_url ?? null,
        voiceUrl: r.voice_url ?? null,
        voiceDurationMs: r.voice_duration_ms ?? null,
        voiceWaveform: r.voice_waveform ?? null,
        videoUrl: r.video_url ?? null,
        videoDurationMs: r.video_duration_ms ?? null,
        videoThumbnailUrl: r.video_thumbnail_url ?? null,
        quotedComment: quotedSnapshot(r.quoted_comment_id),
        location:
          r.location_lat != null && r.location_lng != null
            ? { lat: r.location_lat, lng: r.location_lng, label: r.location_label ?? null }
            : null,
        // Prefer the live reaction tally; fall back to the denormalized counter.
        likesCount: total || (r.likes_count ?? 0),
        viewerLiked: !!viewerReaction,
        reactions,
        viewerReaction,
        mood: r.mood ?? null,
        pinned: !!r.pinned,
        pinLabel: r.pin_label ?? null,
        pinnedAt: r.pinned_at ?? null,
        isBest: !!r.is_best,
        createdAt: r.created_at,
        editedAt: r.edited_at ?? null,
        author: authorById.get(r.author_id) ?? null,
        canDelete: canDelete(r.author_id),
        canEdit: canEdit(r.author_id),
        canModerate,
        replies: [],
      };
    };

    // Part 5 tranche 2: real arbitrary-depth threading. Grouping by parent_id
    // was always generic (works at any depth) — the "one level deep" limit
    // lived entirely in the WRITE path (see app/api/posts/[id]/comments),
    // which no longer flattens. Rows are already created_at-ascending, so
    // each node's replies land in chronological order for free.
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
      const parent = r.parent_id ? nodes.get(r.parent_id) : undefined;
      // A reply whose parent is missing (deleted, or hidden via a block) is
      // surfaced at the top level rather than silently dropped — "unknown
      // parent" is not the same as "this comment doesn't exist" (same
      // principle as Part 4's `unknown ≠ zero` provenance rule).
      if (parent) parent.replies.push(node);
      else top.push(node);
    }
    return top;
  } catch {
    return [];
  }
}

export type CommentGate =
  | { ok: true }
  | { ok: false; reason: "off" | "followers" | "blocked" | "muted" | "unavailable" };

/** Whether `viewerId` may comment on `postId` (comments_policy + blocks +
 *  mute-this-commenter, Part 5 tranche 4). */
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

    // Mute-this-commenter — narrower than a block (see 0122's own comment):
    // the muted user keeps following/messaging/seeing this creator's posts,
    // they just can't comment on them. Its own try/catch: a missing
    // comment_muted_users table (0122 not applied yet) must degrade to
    // "not muted" rather than take down commenting entirely — same
    // graceful-degrade discipline every other optional-migration read in
    // this file already follows (see listComments' EXT/BASE fallback).
    try {
      const { count: muted } = await db
        .from("comment_muted_users")
        .select("creator_id", { head: true, count: "exact" })
        .eq("creator_id", publisherId)
        .eq("muted_user_id", viewerId);
      if ((muted ?? 0) > 0) return { ok: false, reason: "muted" };
    } catch {
      /* comment_muted_users not migrated yet */
    }

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

/** Comment body matches one of the publisher's own muted keywords (Part 5
 *  tranche 4)? Case-insensitive substring match — no regex, no per-keyword
 *  metadata, matching commentSpamReason's own "simple heuristic, not a
 *  content-moderation platform" scope. Gracefully returns false if 0122
 *  isn't applied yet (the column just doesn't exist). */
export async function commentKeywordBlocked(publisherId: string, body: string): Promise<boolean> {
  if (!hasSupabase || !body.trim()) return false;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("privacy_settings")
      .select("muted_comment_keywords")
      .eq("user_id", publisherId)
      .maybeSingle();
    if (error || !data) return false;
    const keywords = (data.muted_comment_keywords as string[] | null) ?? [];
    if (keywords.length === 0) return false;
    const lower = body.toLowerCase();
    return keywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
  } catch {
    return false;
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
