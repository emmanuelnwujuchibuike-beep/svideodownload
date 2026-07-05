import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Repost data access (Twitter-retweet model — a repost points at the original
 * post, media is never duplicated). Every function is BEST-EFFORT: if the
 * `reposts` table / `posts.reposts_count` column aren't migrated yet, it returns
 * empty/false/0 instead of throwing, so the app runs fine before migration 0025
 * is applied and upgrades automatically afterwards.
 *
 * `listUserReposts` (the profile Reposts tab) lives in `posts.ts` so it can reuse
 * the private post-card mapper.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Which of these post ids the viewer has reposted. */
export async function viewerReposts(postIds: string[], viewerId: string | null): Promise<Set<string>> {
  if (!hasSupabase || !viewerId || postIds.length === 0) return new Set();
  try {
    const db = createAdminClient();
    const { data } = await db.from("reposts").select("post_id").eq("user_id", viewerId).in("post_id", postIds);
    return new Set(((data ?? []) as { post_id: string }[]).map((r) => r.post_id));
  } catch {
    return new Set();
  }
}

export interface RepostBadge {
  /** Up to 3 avatars of people the viewer follows who reposted this. */
  avatars: (string | null)[];
  handles: string[];
  /** Total number of followed users who reposted it (may exceed 3). */
  count: number;
}

/**
 * For each post, the people the viewer FOLLOWS who reposted it — powers the
 * premium repost badge (overlapping avatars + "+N"). Best-effort.
 */
export async function followedReposters(postIds: string[], followingIds: string[]): Promise<Map<string, RepostBadge>> {
  const out = new Map<string, RepostBadge>();
  if (!hasSupabase || postIds.length === 0 || followingIds.length === 0) return out;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("reposts")
      .select("post_id, user_id")
      .in("post_id", postIds)
      .in("user_id", followingIds)
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as { post_id: string; user_id: string }[];
    if (rows.length === 0) return out;

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: profs } = await db.from("profiles").select("id, handle, avatar_url").in("id", userIds);
    const profById = new Map(((profs ?? []) as { id: string; handle: string; avatar_url: string | null }[]).map((p) => [p.id, p]));

    const byPost = new Map<string, { post_id: string; user_id: string }[]>();
    for (const r of rows) {
      const arr = byPost.get(r.post_id) ?? [];
      arr.push(r);
      byPost.set(r.post_id, arr);
    }
    for (const [postId, list] of byPost) {
      const top = list.slice(0, 3).map((r) => profById.get(r.user_id)).filter(Boolean) as { handle: string; avatar_url: string | null }[];
      out.set(postId, { avatars: top.map((p) => p.avatar_url), handles: top.map((p) => p.handle), count: list.length });
    }
  } catch {
    /* reposts not migrated */
  }
  return out;
}

/** Repost counts for these post ids (from the denormalized column). */
export async function repostCounts(postIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!hasSupabase || postIds.length === 0) return out;
  try {
    const db = createAdminClient();
    const { data } = await db.from("posts").select("id, reposts_count").in("id", postIds);
    for (const r of (data ?? []) as { id: string; reposts_count: number | null }[]) {
      out.set(r.id, r.reposts_count ?? 0);
    }
  } catch {
    /* column not migrated */
  }
  return out;
}
