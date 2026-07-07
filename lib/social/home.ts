import { getCached } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface HomeProfile {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followingCount: number;
  followersCount: number;
  likesCount: number;
}

/**
 * Identity check used on the home/downloads blocking path (decides the
 * welcome-redirect + the greeting name) and by the persistent shell layouts.
 * Cached briefly since it runs on that blocking path — 20s staleness is
 * invisible for a header. Deliberately does NOT compute `likesCount` (no
 * current route renders it — the public profile page has its own independent
 * stats query); summing `likes_count` across a user's posts here would scan up
 * to 500 rows on every uncached load of a page that never displays the number.
 * If a surface needs it again, fetch it in that surface's own Suspense slice.
 */
export async function getHomeProfile(userId: string): Promise<HomeProfile | null> {
  if (!hasSupabase) return null;
  return getCached(`home:profile:${userId}`, 20, () => loadHomeProfile(userId));
}

async function loadHomeProfile(userId: string): Promise<HomeProfile | null> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, followers_count, following_count")
      .eq("id", userId)
      .maybeSingle();
    if (!data) return null;
    const p = data as {
      id: string;
      handle: string | null;
      display_name: string | null;
      avatar_url: string | null;
      is_verified: boolean;
      followers_count: number | null;
      following_count: number | null;
    };

    return {
      id: p.id,
      handle: p.handle,
      displayName: p.display_name || (p.handle ? `@${p.handle}` : "Welcome"),
      avatarUrl: p.avatar_url,
      isVerified: p.is_verified ?? false,
      followingCount: p.following_count ?? 0,
      followersCount: p.followers_count ?? 0,
      likesCount: 0,
    };
  } catch {
    return null;
  }
}
