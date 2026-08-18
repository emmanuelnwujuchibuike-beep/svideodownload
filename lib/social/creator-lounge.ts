import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Creator Lounge™ (Feature 15 Part 5 tranche 4) — a creator-facing surface
 * over comments on THEIR OWN posts, built from real, already-stored signals
 * only. No fabricated "trending" claim, no invented topic-clustering — the
 * same Reality Ledger discipline Part 4/6 established:
 *
 *  - "Unanswered questions" = a real, checkable fact: a comment tagged
 *    mood='question' with no DIRECT reply from the creator. Not a subtree
 *    walk (a creator's reply three levels down still counts as "answered"
 *    in spirit, but checking every depth for every question across every
 *    post is a cost this page shouldn't pay for a nicety) — direct replies
 *    cover the overwhelming common case honestly.
 *  - "Positive feedback" = comments with the most reactions, full stop. No
 *    sentiment model, no invented positivity score.
 *  - "Active discussions" = posts ranked by comment count in the last 48h.
 *    A real count of real rows, not an algorithmic "trending" assertion.
 */

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface LoungeAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface UnansweredQuestion {
  commentId: string;
  postId: string;
  postTitle: string;
  author: LoungeAuthor | null;
  body: string;
  createdAt: string;
}

export interface TopComment {
  commentId: string;
  postId: string;
  postTitle: string;
  author: LoungeAuthor | null;
  body: string;
  reactionCount: number;
}

export interface ActiveDiscussion {
  postId: string;
  postTitle: string;
  recentCommentCount: number;
}

export interface TopSupporter {
  author: LoungeAuthor;
  commentCount: number;
}

export interface CreatorLounge {
  unanswered: UnansweredQuestion[];
  topComments: TopComment[];
  activeDiscussions: ActiveDiscussion[];
  /** % of top-level comments (excluding the creator's own) that got at
   *  least one direct reply from the creator. Real ratio of real rows — no
   *  sentiment score, no invented "engagement health" index (see the
   *  module doc: this file doesn't fake what it can't measure). */
  replyRatePercent: number;
  /** Commenters ranked by how many comments they've left across the
   *  creator's posts — "most active supporters," a real count. */
  topSupporters: TopSupporter[];
}

const EMPTY: CreatorLounge = { unanswered: [], topComments: [], activeDiscussions: [], replyRatePercent: 0, topSupporters: [] };

export async function getCreatorLounge(creatorId: string, postLimit = 100): Promise<CreatorLounge> {
  if (!hasSupabase) return EMPTY;
  try {
    const db = createAdminClient();

    const { data: postRows } = await db
      .from("posts")
      .select("id, title")
      .eq("publisher_id", creatorId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(postLimit);
    const posts = (postRows ?? []) as { id: string; title: string }[];
    if (posts.length === 0) return EMPTY;
    const postIds = posts.map((p) => p.id);
    const titleById = new Map(posts.map((p) => [p.id, p.title]));

    const { data: commentRows } = await db
      .from("post_comments")
      .select("id, post_id, author_id, parent_id, body, mood, likes_count, created_at")
      .in("post_id", postIds)
      .eq("status", "visible")
      .order("created_at", { ascending: false })
      .limit(2000);
    const rawComments = (commentRows ?? []) as {
      id: string;
      post_id: string;
      author_id: string;
      parent_id: string | null;
      body: string;
      mood: string | null;
      likes_count: number | null;
      created_at: string;
    }[];

    // Exclude comments from anyone the creator has blocked — a comment
    // posted before the block still exists, but listComments() already
    // hides it from the creator's own view of the thread; resurfacing it
    // here (where the creator IS the viewer) would be a real inconsistency,
    // not just a missed nicety.
    const { data: blockRows } = await db.from("blocks").select("blocker_id, blocked_id").eq("blocker_id", creatorId);
    const blockedByCreator = new Set(((blockRows ?? []) as { blocked_id: string }[]).map((b) => b.blocked_id));
    const comments = rawComments.filter((c) => !blockedByCreator.has(c.author_id));

    const authorIds = [...new Set(comments.map((c) => c.author_id))];
    const { data: profRows } = authorIds.length
      ? await db.from("profiles").select("id, handle, display_name, avatar_url").in("id", authorIds)
      : { data: [] as never[] };
    const authorById = new Map(
      ((profRows ?? []) as { id: string; handle: string | null; display_name: string | null; avatar_url: string | null }[])
        .filter((p) => p.handle)
        .map((p) => [
          p.id,
          { handle: p.handle as string, displayName: p.display_name || `@${p.handle}`, avatarUrl: p.avatar_url } satisfies LoungeAuthor,
        ]),
    );

    // Direct replies FROM the creator, by parent_id — used to mark a
    // question "answered" without a full subtree walk (see module doc).
    const creatorRepliedTo = new Set(comments.filter((c) => c.author_id === creatorId && c.parent_id).map((c) => c.parent_id as string));

    const unanswered: UnansweredQuestion[] = comments
      .filter((c) => c.mood === "question" && c.author_id !== creatorId && !creatorRepliedTo.has(c.id))
      .slice(0, 30)
      .map((c) => ({
        commentId: c.id,
        postId: c.post_id,
        postTitle: titleById.get(c.post_id) ?? "",
        author: authorById.get(c.author_id) ?? null,
        body: c.body,
        createdAt: c.created_at,
      }));

    const topComments: TopComment[] = [...comments]
      .filter((c) => (c.likes_count ?? 0) > 0)
      .sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0))
      .slice(0, 20)
      .map((c) => ({
        commentId: c.id,
        postId: c.post_id,
        postTitle: titleById.get(c.post_id) ?? "",
        author: authorById.get(c.author_id) ?? null,
        body: c.body,
        reactionCount: c.likes_count ?? 0,
      }));

    const since48h = Date.now() - 48 * 60 * 60 * 1000;
    const recentCountByPost = new Map<string, number>();
    for (const c of comments) {
      if (new Date(c.created_at).getTime() < since48h) continue;
      recentCountByPost.set(c.post_id, (recentCountByPost.get(c.post_id) ?? 0) + 1);
    }
    const activeDiscussions: ActiveDiscussion[] = [...recentCountByPost.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([postId, count]) => ({ postId, postTitle: titleById.get(postId) ?? "", recentCommentCount: count }));

    // Reply rate — of top-level comments from OTHER people, how many got a
    // direct reply from the creator. Reuses `creatorRepliedTo` above (§0).
    const topLevelFromOthers = comments.filter((c) => !c.parent_id && c.author_id !== creatorId);
    const replyRatePercent =
      topLevelFromOthers.length === 0
        ? 0
        : Math.round((topLevelFromOthers.filter((c) => creatorRepliedTo.has(c.id)).length / topLevelFromOthers.length) * 100);

    // Top supporters — real comment counts, no engagement-quality weighting.
    const countByAuthor = new Map<string, number>();
    for (const c of comments) {
      if (c.author_id === creatorId) continue;
      countByAuthor.set(c.author_id, (countByAuthor.get(c.author_id) ?? 0) + 1);
    }
    const topSupporters: TopSupporter[] = [...countByAuthor.entries()]
      .map(([authorId, commentCount]) => ({ author: authorById.get(authorId), commentCount }))
      .filter((s): s is TopSupporter => !!s.author)
      .sort((a, b) => b.commentCount - a.commentCount)
      .slice(0, 10);

    return { unanswered, topComments, activeDiscussions, replyRatePercent, topSupporters };
  } catch {
    return EMPTY;
  }
}
