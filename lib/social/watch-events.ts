import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Watch-depth signal (Feature 15 Part 8) — the one input the Part 8 audit
 * found genuinely missing: post_views counts THAT a post was seen, this
 * records HOW MUCH of it was actually watched. Feeds `posts.completion_rate`
 * / `momentum_score` (see recompute_momentum_scores, migration 0133) and
 * FrenzDNA's interest weights. Fire-and-forget by design, same discipline as
 * `recordPostView` — a discovery signal must never be able to break playback.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Which discovery surface served the post. Doubles as the input to Discovery
 * Analytics' Traffic Sources — an orbit id (see lib/social/orbits.ts) is a
 * valid source too, passed through verbatim rather than re-enumerated here.
 */
export type WatchSource =
  | "for_you"
  | "following"
  | "recent"
  | "trending"
  | "post_page"
  | "search"
  | "profile"
  | "collection"
  | (string & {});

export async function recordWatchEvent(
  postId: string,
  viewerId: string | null,
  ipHash: string,
  watchMs: number,
  durationMs: number,
  source?: WatchSource | null,
): Promise<void> {
  if (!hasSupabase) return;
  if (!postId || !Number.isFinite(watchMs) || watchMs <= 0) return;
  try {
    const db = createAdminClient();
    await db.from("post_watch_events").insert({
      post_id: postId,
      viewer_id: viewerId,
      ip_hash: viewerId ? "" : ipHash,
      watch_ms: Math.max(0, Math.round(watchMs)),
      duration_ms: Math.max(0, Math.round(durationMs || 0)),
      source: source ?? null,
    });
  } catch {
    /* transient error — a missed watch event degrades personalization, never playback */
  }
}
