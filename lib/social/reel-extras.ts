import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SMART COMMENT PREVIEW + STORY RING (Feature 15, Part 3 — tranche 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two per-post extras that the reel rail needs and the feed did not return.
 * They share a module because they share a shape — one batched read per feed
 * page, keyed by post id, failing open to nothing — and because a third round
 * trip per page is worth avoiding.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface CommentPreview {
  body: string;
  authorHandle: string;
  authorName: string;
  authorAvatarUrl: string | null;
  /** Why THIS comment was chosen — rendered as the badge, never invented. */
  reason: "friend" | "creator" | "verified" | "top" | "newest";
  likes: number;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  likes_count?: number | null;
}

interface AuthorRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
}

/**
 * ── 🔴 WHICH COMMENT WINS, and why it is not "the newest" ──────────────────
 *
 * "Instead of always showing the latest comment, the system intelligently
 *  displays: friend comment, verified comment, trending comment, creator reply…"
 *
 * The newest comment is the worst default on a reel: on anything popular it is
 * whatever landed in the last few seconds, which is the least considered thing
 * anyone said. The order below is by how much the comment tells THIS viewer:
 *
 *   1. A FRIEND. Someone they follow. Nothing else on the screen carries that.
 *   2. THE CREATOR. A reply from the person who made the video is the one
 *      comment guaranteed to be about the video rather than about the comments.
 *   3. A VERIFIED account — a weak signal, but a real one, and it is a fact
 *      about the account rather than a guess about the text.
 *   4. THE MOST LIKED. "Trending" and "funniest" and "most helpful" from the
 *      brief are all this one measurement wearing different names; there is no
 *      sentiment model here and inventing one would make the badge a lie.
 *   5. The newest, as the floor.
 *
 * `reason` travels with the pick so the UI can SAY why, and can only say things
 * that are true — the badge is derived from the same branch that made the
 * choice, not decided separately in a component.
 *
 * Pure and exported so the ordering is testable without a database, which is
 * the part with actual behaviour in it.
 */
export function pickPreview(
  rows: CommentRow[],
  authors: Map<string, AuthorRow>,
  ctx: { publisherId: string; followingIds: Set<string> },
): CommentPreview | null {
  const usable = rows.filter((r) => authors.get(r.author_id)?.handle && r.body.trim().length > 0);
  if (usable.length === 0) return null;

  const build = (r: CommentRow, reason: CommentPreview["reason"]): CommentPreview => {
    const a = authors.get(r.author_id)!;
    return {
      body: r.body.trim(),
      authorHandle: a.handle!,
      authorName: a.display_name || a.handle!,
      authorAvatarUrl: a.avatar_url,
      reason,
      likes: r.likes_count ?? 0,
    };
  };

  const friend = usable.find((r) => ctx.followingIds.has(r.author_id) && r.author_id !== ctx.publisherId);
  if (friend) return build(friend, "friend");

  const creator = usable.find((r) => r.author_id === ctx.publisherId);
  if (creator) return build(creator, "creator");

  const verified = usable.find((r) => authors.get(r.author_id)?.is_verified);
  if (verified) return build(verified, "verified");

  // Most liked, and only when the likes are a real signal. A single like is
  // noise, and badging it "Top comment" would be the kind of small inflation
  // that makes every other badge less believable.
  const byLikes = [...usable].sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
  if ((byLikes[0]?.likes_count ?? 0) >= 2) return build(byLikes[0]!, "top");

  // Rows arrive newest-first.
  return build(usable[0]!, "newest");
}

/**
 * One preview comment per post.
 *
 * Reads a small window of recent comments per page and picks within it, rather
 * than asking the database for "the best comment" — that would be a correlated
 * subquery per post, and this runs on every feed page.
 */
export async function commentPreviewsForPosts(
  posts: { id: string; publisherId: string }[],
  followingIds: string[],
): Promise<Map<string, CommentPreview>> {
  const out = new Map<string, CommentPreview>();
  if (!hasSupabase || posts.length === 0) return out;
  try {
    const db = createAdminClient();
    const ids = posts.map((p) => p.id);

    // `likes_count` arrives with a later migration — fall back cleanly rather
    // than losing every preview to one missing column, the same tolerance
    // `fetchReactionRows` applies for the same reason.
    const select = "id, post_id, author_id, body, created_at, likes_count";
    let rows: CommentRow[];
    const first = await db
      .from("post_comments")
      .select(select)
      .in("post_id", ids)
      .eq("status", "visible")
      .order("created_at", { ascending: false })
      .limit(240);
    if (first.error) {
      const { data } = await db
        .from("post_comments")
        .select("id, post_id, author_id, body, created_at")
        .in("post_id", ids)
        .eq("status", "visible")
        .order("created_at", { ascending: false })
        .limit(240);
      rows = (data ?? []) as CommentRow[];
    } else {
      rows = (first.data ?? []) as CommentRow[];
    }
    if (rows.length === 0) return out;

    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    const { data: profs } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified")
      .in("id", authorIds);
    const authors = new Map(((profs ?? []) as AuthorRow[]).map((p) => [p.id, p]));

    const following = new Set(followingIds);
    const byPost = new Map<string, CommentRow[]>();
    for (const r of rows) {
      const arr = byPost.get(r.post_id) ?? [];
      arr.push(r);
      byPost.set(r.post_id, arr);
    }
    for (const p of posts) {
      const list = byPost.get(p.id);
      if (!list?.length) continue;
      const pick = pickPreview(list, authors, { publisherId: p.publisherId, followingIds: following });
      if (pick) out.set(p.id, pick);
    }
  } catch {
    /* not migrated / unavailable — no preview is a correct, quiet result */
  }
  return out;
}

/**
 * Which of these creators have a story that is still live.
 *
 * Powers the ring around the rail avatar. A set rather than a map: the ring is
 * a boolean, and returning story CONTENT here would be a second payload the
 * viewer may never open.
 *
 * 🔴 `expires_at > now` is evaluated by the DATABASE, not in JS. A story that
 * expired between the query and the render would otherwise still draw a ring
 * that opens nothing — the "phantom ring" the story cache already documents.
 */
export async function creatorsWithActiveStories(creatorIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!hasSupabase || creatorIds.length === 0) return out;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("stories")
      .select("user_id")
      .in("user_id", [...new Set(creatorIds)])
      .gt("expires_at", new Date().toISOString())
      .limit(200);
    for (const r of (data ?? []) as { user_id: string }[]) out.add(r.user_id);
  } catch {
    /* stories unavailable — no rings, which is the correct empty state */
  }
  return out;
}
