import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-creator analytics for Business accounts — aggregates the user's own posts
 * + engagement. Reads the denormalized counters (cheap) and the deduped
 * post_views table for windowed reach.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface CreatorTopPost {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  views: number;
  downloads: number;
  engagement: number; // likes + saves + shares + comments
}

export interface CreatorAnalytics {
  totals: {
    posts: number;
    views: number;
    downloads: number;
    likes: number;
    saves: number;
    shares: number;
    comments: number;
  };
  views7d: number;
  views30d: number;
  followers: number;
  following: number;
  engagementRate: number; // % engagement per view
  topPosts: CreatorTopPost[];
}

const EMPTY: CreatorAnalytics = {
  totals: { posts: 0, views: 0, downloads: 0, likes: 0, saves: 0, shares: 0, comments: 0 },
  views7d: 0,
  views30d: 0,
  followers: 0,
  following: 0,
  engagementRate: 0,
  topPosts: [],
};

interface Row {
  id: string;
  title: string;
  thumbnail_url: string | null;
  views_count: number;
  downloads_count: number;
  likes_count: number;
  saves_count: number;
  shares_count: number;
  comments_count: number;
}

export async function getCreatorAnalytics(userId: string): Promise<CreatorAnalytics> {
  if (!hasSupabase) return EMPTY;
  try {
    const db = createAdminClient();

    const [{ data: postRows }, { data: prof }] = await Promise.all([
      db
        .from("posts")
        .select("id, title, thumbnail_url, views_count, downloads_count, likes_count, saves_count, shares_count, comments_count")
        .eq("publisher_id", userId)
        .neq("status", "removed")
        .limit(1000),
      db.from("profiles").select("followers_count, following_count").eq("id", userId).maybeSingle(),
    ]);

    const rows = (postRows as Row[]) ?? [];
    const totals = rows.reduce(
      (t, r) => {
        t.posts += 1;
        t.views += r.views_count;
        t.downloads += r.downloads_count;
        t.likes += r.likes_count;
        t.saves += r.saves_count;
        t.shares += r.shares_count;
        t.comments += r.comments_count;
        return t;
      },
      { posts: 0, views: 0, downloads: 0, likes: 0, saves: 0, shares: 0, comments: 0 },
    );

    const engagement = totals.likes + totals.saves + totals.shares + totals.comments;
    const engagementRate = totals.views > 0 ? Math.round((engagement / totals.views) * 1000) / 10 : 0;

    // Windowed reach from the deduped views table.
    const postIds = rows.map((r) => r.id);
    let views7d = 0;
    let views30d = 0;
    if (postIds.length > 0) {
      const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
      const [w7, w30] = await Promise.all([
        db.from("post_views").select("id", { head: true, count: "exact" }).in("post_id", postIds).gte("created_at", since(7)),
        db.from("post_views").select("id", { head: true, count: "exact" }).in("post_id", postIds).gte("created_at", since(30)),
      ]);
      views7d = w7.count ?? 0;
      views30d = w30.count ?? 0;
    }

    const topPosts: CreatorTopPost[] = rows
      .map((r) => ({
        id: r.id,
        title: r.title,
        thumbnailUrl: r.thumbnail_url,
        views: r.views_count,
        downloads: r.downloads_count,
        engagement: r.likes_count + r.saves_count + r.shares_count + r.comments_count,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    return {
      totals,
      views7d,
      views30d,
      followers: (prof?.followers_count as number) ?? 0,
      following: (prof?.following_count as number) ?? 0,
      engagementRate,
      topPosts,
    };
  } catch {
    return EMPTY;
  }
}
