import { getCached } from "@/lib/cache";
import { createAdminClient } from "@/lib/supabase/admin";

import { type Category } from "./categories";
import type { PostCard } from "./posts";

/**
 * Discovery feed (Explore / trending). Only PUBLIC, published posts appear.
 * Privacy always wins: publishers who hid themselves from recommendations
 * (`show_in_recommendations=false`), are suspended, or block the viewer are
 * excluded. A per-publisher diversity cap stops one creator monopolising the
 * feed. Scoring is precomputed into `posts.hot_score` (see migration 0009).
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface TrendingSettings {
  wView: number;
  wDownload: number;
  wLike: number;
  wSave: number;
  wShare: number;
  wComment: number;
  gravity: number;
  maxAgeHours: number;
  diversityCap: number;
  /** Hide creators below this trust score from the discovery feed (0 = off). */
  feedTrustMin: number;
}

export const DEFAULT_TRENDING: TrendingSettings = {
  wView: 1,
  wDownload: 4,
  wLike: 3,
  wSave: 5,
  wShare: 6,
  wComment: 4,
  gravity: 1.5,
  maxAgeHours: 168, // 7 days
  diversityCap: 2,
  feedTrustMin: 0,
};

let trendingCache: { at: number; value: TrendingSettings } | null = null;

export async function getTrendingSettings(): Promise<TrendingSettings> {
  if (trendingCache && Date.now() - trendingCache.at < 60_000) return trendingCache.value;
  if (!hasSupabase) return DEFAULT_TRENDING;
  try {
    const { data } = await createAdminClient()
      .from("settings")
      .select("value")
      .eq("key", "trending")
      .maybeSingle();
    const merged = { ...DEFAULT_TRENDING, ...((data?.value ?? {}) as Partial<TrendingSettings>) };
    trendingCache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_TRENDING;
  }
}

export async function setTrendingSettings(s: TrendingSettings): Promise<void> {
  await createAdminClient().from("settings").upsert({ key: "trending", value: s }, { onConflict: "key" });
  trendingCache = null;
}

/** Recompute trust scores for all (non-suspended) accounts. */
export async function recomputeTrustScores(): Promise<number> {
  if (!hasSupabase) return 0;
  const { data } = await createAdminClient().rpc("recompute_trust_scores");
  return (data as number) ?? 0;
}

/** Recompute hot_score for recent posts using the admin-tuned weights. */
export async function recomputeHotScores(): Promise<number> {
  if (!hasSupabase) return 0;
  const s = await getTrendingSettings();
  const { data } = await createAdminClient().rpc("recompute_hot_scores", {
    w_view: s.wView,
    w_download: s.wDownload,
    w_like: s.wLike,
    w_save: s.wSave,
    w_share: s.wShare,
    w_comment: s.wComment,
    gravity: s.gravity,
    max_age_hours: s.maxAgeHours,
  });
  return (data as number) ?? 0;
}

interface FeedRow {
  id: string;
  publisher_id: string;
  title: string;
  platform: string;
  media_kind: PostCard["mediaKind"];
  thumbnail_url: string | null;
  media_url: string | null;
  category: string | null;
  views_count: number;
  likes_count: number;
  comments_count: number;
  created_at: string;
}

export type FeedSort = "trending" | "recent";

/**
 * A privacy-filtered, diversity-capped page of the public discovery feed.
 * Cached briefly per (sort, category, limit, viewer): discovery content is shared,
 * so anonymous/SEO traffic hits one warm entry instead of re-running the queries.
 */
export async function getFeed(opts: {
  sort: FeedSort;
  category?: Category | null;
  viewerId: string | null;
  limit?: number;
}): Promise<PostCard[]> {
  if (!hasSupabase) return [];
  const limit = opts.limit ?? 24;
  const category = opts.category ?? null;
  const key = `feed:${opts.sort}:${category ?? "all"}:${limit}:${opts.viewerId ?? "anon"}`;
  return getCached(key, 45, () => loadFeed(opts.sort, category, opts.viewerId, limit));
}

async function loadFeed(
  sort: FeedSort,
  category: Category | null,
  viewerId: string | null,
  limit: number,
): Promise<PostCard[]> {
  try {
    const db = createAdminClient();
    const settings = await getTrendingSettings();

    let q = db
      .from("posts")
      .select("id, publisher_id, title, platform, media_kind, thumbnail_url, media_url, category, views_count, likes_count, comments_count, created_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .limit(limit * 4); // over-fetch for filtering + diversity
    if (category) q = q.eq("category", category);
    q = sort === "recent"
      ? q.order("created_at", { ascending: false })
      : q.order("hot_score", { ascending: false }).order("created_at", { ascending: false });

    const { data } = await q;
    const rows = (data as FeedRow[]) ?? [];
    if (rows.length === 0) return [];

    const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
    const [{ data: profs }, { data: privs }, blocks] = await Promise.all([
      db.from("profiles").select("id, is_suspended, trust_score").in("id", publisherIds),
      db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
      viewerId
        ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
        : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    ]);

    const profRows = (profs ?? []) as { id: string; is_suspended: boolean; trust_score: number }[];
    const suspended = new Set(profRows.filter((p) => p.is_suspended).map((p) => p.id));
    // Shadow-discount: keep low-trust creators out of discovery.
    const lowTrust = new Set(
      settings.feedTrustMin > 0
        ? profRows.filter((p) => (p.trust_score ?? 0) < settings.feedTrustMin).map((p) => p.id)
        : [],
    );
    const hidden = new Set(
      ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
        .filter((p) => !p.show_in_recommendations)
        .map((p) => p.user_id),
    );
    const blocked = new Set<string>();
    for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
      blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }

    const perPublisher = new Map<string, number>();
    const out: PostCard[] = [];
    for (const r of rows) {
      if (
        suspended.has(r.publisher_id) ||
        lowTrust.has(r.publisher_id) ||
        hidden.has(r.publisher_id) ||
        blocked.has(r.publisher_id)
      )
        continue;
      const n = perPublisher.get(r.publisher_id) ?? 0;
      if (n >= settings.diversityCap) continue;
      perPublisher.set(r.publisher_id, n + 1);
      out.push({
        id: r.id,
        title: r.title,
        platform: r.platform,
        mediaKind: r.media_kind,
        thumbnailUrl: r.thumbnail_url,
        mediaUrl: r.media_url,
        category: r.category,
        viewsCount: r.views_count,
        likesCount: r.likes_count,
        commentsCount: r.comments_count,
        createdAt: r.created_at,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
