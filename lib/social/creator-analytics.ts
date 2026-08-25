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

/** Discovery Analytics (Feature 15 Part 8) — real, measurable signals only.
 *  Country/city reach is deliberately absent: views are identified by
 *  viewer_id or a hashed IP, never resolved to a location anywhere in this
 *  app, so a "Country Reach" number would have to be invented. Follower
 *  conversion is the raw follower DELTA over the window, not a causal
 *  "this post caused N follows" claim — nothing here attributes a follow to
 *  a specific post, and pretending otherwise would be exactly the kind of
 *  fabricated stat this project has declined three times. */
export interface DiscoveryAnalytics {
  /** Where views on this creator's posts came from (post_watch_events.source
   *  ∪ post_views.source) — real surface tags, not modeled. */
  trafficSources: { source: string; count: number }[];
  /** Average watch-completion across this creator's posts (0-1), from real
   *  watch-depth events — absent (0) until post_watch_events has data. */
  retention: number;
  /** Views grouped by the creator's OWN post categories — trivial once posts
   *  and views are both in hand, no extra modeling. */
  topicReach: { category: string; views: number }[];
  /** Followers gained during the last 7 days (denormalized counter delta is
   *  unavailable, so this reads new `follows` rows directly — a real count,
   *  not an attribution). */
  newFollowers7d: number;
}

const EMPTY_DISCOVERY: DiscoveryAnalytics = { trafficSources: [], retention: 0, topicReach: [], newFollowers7d: 0 };

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
  discovery: DiscoveryAnalytics;
}

const EMPTY: CreatorAnalytics = {
  totals: { posts: 0, views: 0, downloads: 0, likes: 0, saves: 0, shares: 0, comments: 0 },
  views7d: 0,
  views30d: 0,
  followers: 0,
  following: 0,
  engagementRate: 0,
  topPosts: [],
  discovery: EMPTY_DISCOVERY,
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
  category: string | null;
}

export async function getCreatorAnalytics(userId: string): Promise<CreatorAnalytics> {
  if (!hasSupabase) return EMPTY;
  try {
    const db = createAdminClient();

    const [{ data: postRows }, { data: prof }] = await Promise.all([
      db
        .from("posts")
        .select("id, title, thumbnail_url, views_count, downloads_count, likes_count, saves_count, shares_count, comments_count, category")
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

    // Topic Reach — trivial once rows + views are both in hand: sum each
    // post's OWN view count by ITS OWN category. No extra query.
    const viewsByCategory = new Map<string, number>();
    for (const r of rows) {
      const cat = r.category ?? "other";
      viewsByCategory.set(cat, (viewsByCategory.get(cat) ?? 0) + r.views_count);
    }
    const topicReach = [...viewsByCategory.entries()]
      .map(([category, views]) => ({ category, views }))
      .sort((a, b) => b.views - a.views);

    const discovery = await getDiscoveryAnalytics(db, userId, postIds);

    return {
      totals,
      views7d,
      views30d,
      followers: (prof?.followers_count as number) ?? 0,
      following: (prof?.following_count as number) ?? 0,
      engagementRate,
      topPosts,
      discovery: { ...discovery, topicReach },
    };
  } catch {
    return EMPTY;
  }
}

/** Traffic Sources + Retention + follower delta — isolated so a missing
 *  post_watch_events / source column (pre-migration 0133) degrades to zeros
 *  rather than failing the whole analytics read. `profiles.followers_count`
 *  (used elsewhere in this function) is a live total, not a windowed one —
 *  the 7-day delta here reads `follows` directly instead. */
async function getDiscoveryAnalytics(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  postIds: string[],
): Promise<DiscoveryAnalytics> {
  const since7d = new Date(Date.now() - 7 * 864e5).toISOString();

  let trafficSources: { source: string; count: number }[] = [];
  let retention = 0;
  if (postIds.length > 0) {
    try {
      const { data } = await db.from("post_watch_events").select("source, watch_ms, duration_ms").in("post_id", postIds).limit(5000);
      const rows = (data ?? []) as { source: string | null; watch_ms: number; duration_ms: number }[];
      const counts = new Map<string, number>();
      let completionSum = 0;
      let completionN = 0;
      for (const r of rows) {
        counts.set(r.source ?? "untagged", (counts.get(r.source ?? "untagged") ?? 0) + 1);
        if (r.duration_ms > 0) {
          completionSum += Math.min(1, r.watch_ms / r.duration_ms);
          completionN += 1;
        }
      }
      trafficSources = [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
      retention = completionN > 0 ? Math.round((completionSum / completionN) * 1000) / 10 : 0;
    } catch {
      /* post_watch_events not migrated yet — zeros */
    }
  }

  let newFollowers7d = 0;
  try {
    const { count } = await db
      .from("follows")
      .select("follower_id", { head: true, count: "exact" })
      .eq("following_id", userId)
      .gte("created_at", since7d);
    newFollowers7d = count ?? 0;
  } catch {
    /* best-effort */
  }

  return { trafficSources, retention, topicReach: [], newFollowers7d };
}
