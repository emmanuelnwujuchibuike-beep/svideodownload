import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";

import { friendIdSet } from "../friend-ids";
import { canSeeRepost, type RepostAudience, type ViewerRelation } from "./audience";

/**
 * The audience gate, applied to every read of the `reposts` table
 * (Feature 15 · Part 4).
 *
 * ── 🔴 Why this exists as a shared module and not a filter in each query ──
 * Migration 0116 made a repost able to be private. The moment that column
 * exists, FOUR already-shipped read paths become privacy bugs unless every one
 * of them is updated:
 *
 *   · `reposts.ts`      followedReposters()   → the repost badge
 *   · `home-feed.ts`    surfaceFollowedReposts() → pulling reposts into For You
 *   · `pulse-activity.ts`                     → "David reposted this"
 *   · `posts.ts`        listUserReposts()     → the profile Reposts tab
 *
 * Four hand-written filters is four chances to forget one, and forgetting one
 * publishes something a member marked close-friends-only. So the predicate lives
 * here, the relation is resolved once per request, and each call site applies
 * the same function.
 *
 * ── Fails CLOSED ──────────────────────────────────────────────────────────
 * If the relationship lookups fail, the viewer is treated as a stranger and
 * sees only public reposts. `friend-ids.ts` takes the same direction for the
 * same reason: a database blip must show less, never more.
 *
 * ── Runs fine before 0116 is applied ──────────────────────────────────────
 * Every read tolerates the `audience` column not existing (42703): a row
 * without one is `public`, which is exactly what it was before the migration.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface RepostViewer {
  viewerId: string | null;
  friends: ReadonlySet<string>;
  following: ReadonlySet<string>;
  /** People who have marked THIS viewer as one of their close friends. */
  closeFriendOf: ReadonlySet<string>;
}

export const ANONYMOUS_VIEWER: RepostViewer = {
  viewerId: null,
  friends: new Set(),
  following: new Set(),
  closeFriendOf: new Set(),
};

/**
 * Resolve everything the audience gate needs, in one batch.
 *
 * React-`cache()`d per request, like `friendIdSet`: a feed render asks for this
 * from the badge query, the surfacing query and the Pulse query, and without
 * deduping that is three identical pairs of round-trips on the hot path.
 *
 * Note the direction of the favourites query: `friend_favorites (user_id,
 * friend_id)` means "user_id pinned friend_id". A close-friends repost is
 * visible to the people the REPOSTER pinned, so this reads `friend_id =
 * viewer`, not `user_id = viewer`. Getting that backwards would show a member
 * the close-friends reposts of everyone THEY pinned — the exact inverse of the
 * promise, and it would look correct in a screenshot.
 */
export const repostViewer = cache(async (viewerId: string | null): Promise<RepostViewer> => {
  if (!viewerId || !hasSupabase) return ANONYMOUS_VIEWER;
  try {
    const db = createAdminClient();
    const [friends, follows, favs] = await Promise.all([
      friendIdSet(viewerId),
      db.from("follows").select("following_id").eq("follower_id", viewerId),
      db.from("friend_favorites").select("user_id").eq("friend_id", viewerId),
    ]);
    return {
      viewerId,
      friends,
      following: new Set(((follows.data ?? []) as { following_id: string }[]).map((f) => f.following_id)),
      closeFriendOf: new Set(((favs.data ?? []) as { user_id: string }[]).map((f) => f.user_id)),
    };
  } catch {
    return { ...ANONYMOUS_VIEWER, viewerId };
  }
});

/** The viewer's relation to one reposter, in the shape the pure rule expects. */
export function relationTo(reposterId: string, v: RepostViewer): ViewerRelation {
  return {
    isSelf: v.viewerId === reposterId,
    follows: v.following.has(reposterId),
    isFriend: v.friends.has(reposterId),
    isCloseFriend: v.closeFriendOf.has(reposterId),
  };
}

/** A row shaped enough to be audience-checked. `audience` absent = pre-0116 = public. */
export interface AudienceRow {
  user_id: string;
  audience?: RepostAudience | null;
}

/** Drop every repost row this viewer is not allowed to see. */
export function filterVisibleReposts<T extends AudienceRow>(rows: readonly T[], v: RepostViewer): T[] {
  return rows.filter((r) => canSeeRepost((r.audience ?? "public") as RepostAudience, relationTo(r.user_id, v)));
}

/**
 * The audience values worth fetching at all, for narrowing the query before the
 * rows come back.
 *
 * This is an OPTIMISATION, never the gate — `filterVisibleReposts` still runs on
 * whatever returns. A signed-in viewer's `friends` list is a per-row check that
 * SQL here cannot do, so a query narrowed by this alone would still over-return.
 */
export function audienceValuesFor(v: RepostViewer): RepostAudience[] {
  if (!v.viewerId) return ["public"];
  return ["public", "followers", "friends", "close_friends", "private"];
}

/**
 * Select-with-audience, degrading to select-without on a pre-0116 database.
 *
 * The 42703 fallback is the pattern this codebase already uses for `caption`
 * (0030) and `allow_reshare` (0081): a missing column must cost the feature, not
 * the page.
 */
export async function selectRepostsWithAudience<T>(
  build: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>,
  baseColumns: string,
): Promise<{ rows: T[]; hasAudience: boolean }> {
  const withAudience = await build(`${baseColumns}, audience, source_repost_id`);
  if (!withAudience.error) {
    return { rows: (withAudience.data ?? []) as T[], hasAudience: true };
  }
  const bare = await build(baseColumns);
  if (bare.error) return { rows: [], hasAudience: false };
  return { rows: (bare.data ?? []) as T[], hasAudience: false };
}
