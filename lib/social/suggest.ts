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

    return rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name || `@${r.handle}`,
      avatarUrl: r.avatar_url,
      isVerified: r.is_verified,
      plan: planById.get(r.id) ?? "free",
      followersCount: r.followers_count,
      isFollowing: followingSet.has(r.id),
    }));
  } catch {
    return [];
  }
}
