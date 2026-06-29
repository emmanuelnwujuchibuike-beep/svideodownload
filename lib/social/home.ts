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

/** Header/right-rail identity card for the signed-in user. */
export async function getHomeProfile(userId: string): Promise<HomeProfile | null> {
  if (!hasSupabase) return null;
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

    // Total likes received across the user's published posts.
    let likesCount = 0;
    const { data: posts } = await db
      .from("posts")
      .select("likes_count")
      .eq("publisher_id", userId)
      .eq("status", "published")
      .limit(500);
    for (const row of (posts ?? []) as { likes_count: number | null }[]) {
      likesCount += row.likes_count ?? 0;
    }

    return {
      id: p.id,
      handle: p.handle,
      displayName: p.display_name || (p.handle ? `@${p.handle}` : "Welcome"),
      avatarUrl: p.avatar_url,
      isVerified: p.is_verified ?? false,
      followingCount: p.following_count ?? 0,
      followersCount: p.followers_count ?? 0,
      likesCount,
    };
  } catch {
    return null;
  }
}
