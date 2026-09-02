import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { getCreatorContentItem, type CreatorContentItem } from "./content";
import { rankTagPerformance, type TagPerformance } from "./hashtag-performance";
import { buildRetentionCurve, type RetentionCurve, type WatchSample } from "./retention";

/**
 * Per-post performance (Feature 15 · Part 9) — the detail behind one reel.
 *
 * Everything here is measured. The two things the brief asks for that are NOT
 * here are absent for the same reason they were absent in Part 8:
 *
 *   · "Community reach" — no communities table exists (fourth confirmation).
 *   · "Friend reach" — a watch event records WHICH SURFACE served the post, not
 *     the relationship between viewer and creator. Resolving every viewer to a
 *     friendship would be a second query per viewer, and would answer a
 *     question the source tag already answers better: `following` reach IS the
 *     people who chose to follow.
 *
 * "Discovery reach" is real and is derived from the source tag: the share of
 * watches that came from a surface the viewer did not curate (For You,
 * trending, search, an Orbit) versus one they did (following, profile).
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Watch rows read per post. A very popular post has more; the sample is the
 *  most recent, and `sampleTruncated` says so rather than implying it is all. */
const WATCH_LIMIT = 5000;

/** Surfaces the viewer did NOT explicitly choose — the definition of discovery. */
const DISCOVERY_SOURCES = new Set(["for_you", "trending", "recent", "search", "explore", "collection"]);
/** Surfaces reached because the viewer already knows the creator. */
const FOLLOWED_SOURCES = new Set(["following", "profile"]);

export interface PostInsights {
  post: CreatorContentItem;
  retention: RetentionCurve;
  sampleTruncated: boolean;
  trafficSources: { source: string; count: number; share: number }[];
  reach: { discovery: number; followed: number; other: number };
  /** This post's tags, scored against the creator's own average views per post. */
  tagPerformance: (TagPerformance & { vsAverage: number | null })[];
  /** The creator's mean views per post — the bar every comparison uses. */
  creatorAverageViews: number;
  sound: { id: string; title: string; artistLabel: string; plays: number; postsUsing: number } | null;
  /** Rank of this post among the creator's own, by views. 1 is their best. */
  rankByViews: number | null;
  totalPosts: number;
}

export async function getPostInsights(postId: string, userId: string): Promise<PostInsights | null> {
  if (!hasSupabase) return null;

  const post = await getCreatorContentItem(postId, userId);
  if (!post) return null;

  const db = createAdminClient();

  const [watch, siblings, sound] = await Promise.all([
    db
      .from("post_watch_events")
      .select("watch_ms, duration_ms, source")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(WATCH_LIMIT + 1)
      .then((r) => r, () => ({ data: null })),
    db
      .from("posts")
      .select("id, title, description, views_count, likes_count, comments_count, shares_count, saves_count")
      .eq("publisher_id", userId)
      .neq("status", "removed")
      .limit(1000)
      .then((r) => r, () => ({ data: null })),
    loadSound(db, post.soundId),
  ]);

  const watchRows = ((watch.data ?? []) as { watch_ms: number; duration_ms: number; source: string | null }[]);
  const sampleTruncated = watchRows.length > WATCH_LIMIT;
  const used = watchRows.slice(0, WATCH_LIMIT);

  const samples: WatchSample[] = used.map((r) => ({ watchMs: r.watch_ms, durationMs: r.duration_ms }));
  const retention = buildRetentionCurve(samples);

  const counts = new Map<string, number>();
  const reach = { discovery: 0, followed: 0, other: 0 };
  for (const r of used) {
    const source = r.source ?? "untagged";
    counts.set(source, (counts.get(source) ?? 0) + 1);
    if (DISCOVERY_SOURCES.has(source)) reach.discovery += 1;
    else if (FOLLOWED_SOURCES.has(source)) reach.followed += 1;
    else reach.other += 1;
  }
  const total = used.length || 1;
  const trafficSources = [...counts.entries()]
    .map(([source, count]) => ({ source, count, share: count / total }))
    .sort((a, b) => b.count - a.count);

  const sibRows = ((siblings.data ?? []) as {
    id: string;
    title: string;
    description: string | null;
    views_count: number;
    likes_count: number;
    comments_count: number;
    shares_count: number;
    saves_count: number;
  }[]);

  const creatorAverageViews =
    sibRows.length > 0 ? sibRows.reduce((sum, r) => sum + (r.views_count ?? 0), 0) / sibRows.length : 0;

  const allTagPerf = rankTagPerformance(
    sibRows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      views: r.views_count ?? 0,
      engagement: (r.likes_count ?? 0) + (r.comments_count ?? 0) + (r.shares_count ?? 0) + (r.saves_count ?? 0),
    })),
  );

  const thisPostTags = new Set(post.tags.map((t) => t.toLowerCase()));
  const tagPerformance = allTagPerf
    .filter((t) => thisPostTags.has(t.tag))
    .map((t) => ({
      ...t,
      // Null rather than 0 when there is no baseline: "0% versus average" and
      // "no average to compare against" are different statements.
      vsAverage: creatorAverageViews > 0 ? t.averageViews / creatorAverageViews - 1 : null,
    }));

  const ranked = [...sibRows].sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0));
  const rankIndex = ranked.findIndex((r) => r.id === postId);

  return {
    post,
    retention,
    sampleTruncated,
    trafficSources,
    reach,
    tagPerformance,
    creatorAverageViews,
    sound,
    rankByViews: rankIndex >= 0 ? rankIndex + 1 : null,
    totalPosts: sibRows.length,
  };
}

async function loadSound(
  db: ReturnType<typeof createAdminClient>,
  soundId: string | null,
): Promise<PostInsights["sound"]> {
  if (!soundId) return null;
  try {
    const [{ data }, { count }] = await Promise.all([
      db.from("sounds").select("id, title, artist_label, plays_count").eq("id", soundId).maybeSingle(),
      db.from("posts").select("id", { head: true, count: "exact" }).eq("sound_id", soundId).eq("status", "published"),
    ]);
    if (!data) return null;
    const row = data as { id: string; title: string; artist_label: string | null; plays_count: number | null };
    return {
      id: row.id,
      title: row.title,
      artistLabel: row.artist_label ?? "Unknown",
      plays: row.plays_count ?? 0,
      postsUsing: count ?? 0,
    };
  } catch {
    return null;
  }
}
