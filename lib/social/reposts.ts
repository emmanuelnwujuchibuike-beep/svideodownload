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
