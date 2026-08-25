import { getCached } from "@/lib/cache";
import type { BillingPlan } from "@/lib/monetization/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "People you may know" — public, non-suspended creators with a handle who allow
 * recommendations, ranked by followers. Privacy is respected (private profiles
 * and opt-outs are excluded). Used on the landing "Meet New People" rail.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface SuggestedCreator {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  plan: BillingPlan;
  followersCount: number;
  /** Whether the viewer already follows them — so we never re-offer "Follow". */
  isFollowing: boolean;
  /**
   * How many people the VIEWER follows also follow this creator (Feature 15
   * Part 8 — closes a gap flagged in an earlier audit: this ranking used to
   * be raw follower count only). 0 for an anonymous viewer.
   */
  mutualFriendsCount: number;
}

/**
 * Cached per viewer for 60s. Suggestions don't need to be real-time, and this is
 * the heaviest query on the /home server render (~4 round trips), so caching it
 * cuts first-load TTFB and DB load on repeat visits. A new block/opt-out takes
 * effect within the short TTL window.
 */
export async function getSuggestedCreators(viewerId: string | null, limit = 8): Promise<SuggestedCreator[]> {
  if (!hasSupabase) return [];
  return getCached(`suggest:${viewerId ?? "anon"}:${limit}`, 60, () => loadSuggestedCreators(viewerId, limit));
}

async function loadSuggestedCreators(viewerId: string | null, limit: number): Promise<SuggestedCreator[]> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, followers_count")
      .not("handle", "is", null)
      .eq("visibility", "public")
      .eq("is_suspended", false)
      // Suggestions exist to introduce people who AREN'T connected yet, which is
      // exactly the reach an admin hide removes (0082). So a hidden account is
      // excluded outright here rather than per-viewer: a friend can't be
      // "suggested" to you anyway, so there's no friend case to preserve.
      .eq("is_hidden", false)
      .order("followers_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit * 3);

    let rows = ((data ?? []) as {
      id: string;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      is_verified: boolean;
      followers_count: number;
    }[]).filter((r) => r.id !== viewerId);

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    // Exclude opt-outs + (for a signed-in viewer) blocked relationships.
    const [{ data: privs }, blocks] = await Promise.all([
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", ids),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);
    const optedOut = new Set(
      ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
        .filter((p) => !p.show_in_recommendations)
        .map((p) => p.user_id),
    );
    const blocked = new Set<string>();
    for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    rows = rows.filter((r) => !optedOut.has(r.id) && !blocked.has(r.id)).slice(0, limit);
    if (rows.length === 0) return [];

    const [{ data: subs }, followsRes] = await Promise.all([
      db.from("subscriptions").select("user_id, plan, status").in("user_id", rows.map((r) => r.id)).in("status", ["active", "trialing"]),
      viewerId
        ? db.from("follows").select("following_id").eq("follower_id", viewerId).in("following_id", rows.map((r) => r.id))
        : Promise.resolve({ data: [] as { following_id: string }[] }),
    ]);
    const planById = new Map(((subs ?? []) as { user_id: string; plan: BillingPlan }[]).map((s) => [s.user_id, s.plan]));
    const followingSet = new Set(((followsRes.data ?? []) as { following_id: string }[]).map((f) => f.following_id));
    const mutualById = await mutualFriendCounts(db, viewerId, rows.map((r) => r.id));

    const out = rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name || `@${r.handle}`,
      avatarUrl: r.avatar_url,
      isVerified: r.is_verified,
      plan: planById.get(r.id) ?? "free",
      followersCount: r.followers_count,
      isFollowing: followingSet.has(r.id),
      mutualFriendsCount: mutualById.get(r.id) ?? 0,
    }));

    // Feature 15 Part 8 — a creator several of the viewer's own follows
    // already follow is worth surfacing over a slightly-bigger stranger; the
    // raw follower order (already applied in the SQL fetch above) is kept as
    // the tiebreak, not discarded — this re-sorts the SAME candidate set
    // rather than running a different query.
    out.sort((a, b) => b.mutualFriendsCount - a.mutualFriendsCount || b.followersCount - a.followersCount);
    return out;
  } catch {
    return [];
  }
}

/** For each candidate id, how many accounts the viewer follows ALSO follow
 *  them. One batched query, not N — `follows` has an index on both columns. */
async function mutualFriendCounts(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string | null,
  candidateIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!viewerId || candidateIds.length === 0) return out;
  try {
    const { data: viewerFollows } = await db.from("follows").select("following_id").eq("follower_id", viewerId);
    const viewerFollowingIds = ((viewerFollows ?? []) as { following_id: string }[]).map((f) => f.following_id);
    if (viewerFollowingIds.length === 0) return out;
    const { data } = await db
      .from("follows")
      .select("following_id")
      .in("follower_id", viewerFollowingIds)
      .in("following_id", candidateIds);
    for (const row of (data ?? []) as { following_id: string }[]) {
      out.set(row.following_id, (out.get(row.following_id) ?? 0) + 1);
    }
  } catch {
    /* best-effort — an empty map just means no mutual boost this request */
  }
  return out;
}

/**
 * New Creators discovery (Feature 15 Part 8) — the Creator Fairness surface:
 * deliberately does NOT sort by followers_count at all, so an emerging
 * creator can't be crowded out by exactly the metric this rail exists to
 * look past. Ranked by momentum_score where available (rising engagement
 * relative to age — see recompute_momentum_scores, migration 0133), falling
 * back to recency alone when it isn't (pre-migration).
 */
const NEW_CREATOR_FOLLOWER_CEILING = 2000;

export async function getNewCreators(viewerId: string | null, limit = 8): Promise<SuggestedCreator[]> {
  if (!hasSupabase) return [];
  return getCached(`newcreators:${viewerId ?? "anon"}:${limit}`, 60, () => loadNewCreators(viewerId, limit));
}

async function loadNewCreators(viewerId: string | null, limit: number): Promise<SuggestedCreator[]> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, followers_count, created_at")
      .not("handle", "is", null)
      .eq("visibility", "public")
      .eq("is_suspended", false)
      .eq("is_hidden", false)
      .lt("followers_count", NEW_CREATOR_FOLLOWER_CEILING)
      .order("created_at", { ascending: false })
      .limit(limit * 4);

    let rows = ((data ?? []) as {
      id: string;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      is_verified: boolean;
      followers_count: number;
    }[]).filter((r) => r.id !== viewerId);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [{ data: privs }, blocks] = await Promise.all([
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", ids),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);
    const optedOut = new Set(
      ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
        .filter((p) => !p.show_in_recommendations)
        .map((p) => p.user_id),
    );
    const blocked = new Set<string>();
    for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    rows = rows.filter((r) => !optedOut.has(r.id) && !blocked.has(r.id));
    if (rows.length === 0) return [];

    const [{ data: subs }, followsRes, momentumById] = await Promise.all([
      db.from("subscriptions").select("user_id, plan, status").in("user_id", rows.map((r) => r.id)).in("status", ["active", "trialing"]),
      viewerId
        ? db.from("follows").select("following_id").eq("follower_id", viewerId).in("following_id", rows.map((r) => r.id))
        : Promise.resolve({ data: [] as { following_id: string }[] }),
      creatorMomentum(db, rows.map((r) => r.id)),
    ]);
    const planById = new Map(((subs ?? []) as { user_id: string; plan: BillingPlan }[]).map((s) => [s.user_id, s.plan]));
    const followingSet = new Set(((followsRes.data ?? []) as { following_id: string }[]).map((f) => f.following_id));
    const mutualById = await mutualFriendCounts(db, viewerId, rows.map((r) => r.id));

    const out = rows
      .filter((r) => !followingSet.has(r.id)) // "new creators" — already-followed doesn't belong here
      .map((r) => ({
        id: r.id,
        handle: r.handle,
        displayName: r.display_name || `@${r.handle}`,
        avatarUrl: r.avatar_url,
        isVerified: r.is_verified,
        plan: planById.get(r.id) ?? "free",
        followersCount: r.followers_count,
        isFollowing: false,
        mutualFriendsCount: mutualById.get(r.id) ?? 0,
        momentum: momentumById.get(r.id) ?? 0,
      }));
    out.sort((a, b) => b.mutualFriendsCount - a.mutualFriendsCount || b.momentum - a.momentum);
    return out.slice(0, limit).map(({ momentum: _momentum, ...c }) => c);
  } catch {
    return [];
  }
}

async function creatorMomentum(db: ReturnType<typeof createAdminClient>, creatorIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (creatorIds.length === 0) return out;
  try {
    const { data } = await db
      .from("posts")
      .select("publisher_id, momentum_score")
      .in("publisher_id", creatorIds)
      .eq("status", "published")
      .order("momentum_score", { ascending: false });
    for (const row of (data ?? []) as { publisher_id: string; momentum_score: number }[]) {
      // Keep each creator's best post's momentum (already ordered desc, so
      // the FIRST row seen per publisher is their highest) — a rough but
      // honest per-creator momentum proxy without a dedicated creator-level
      // aggregate column.
      if (!out.has(row.publisher_id)) out.set(row.publisher_id, row.momentum_score ?? 0);
    }
  } catch {
    /* momentum_score not migrated yet — every creator ties at 0, recency-only order */
  }
  return out;
}
