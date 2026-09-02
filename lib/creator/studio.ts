import "server-only";

import { computeAchievements, type EarnedAchievement } from "@/lib/social/achievements";
import { categoryLabel } from "@/lib/social/categories";
import { viewableCollectionsCount } from "@/lib/social/collections";
import { getCreatorAnalytics, type CreatorAnalytics } from "@/lib/social/creator-analytics";
import { getCreatorLounge, type CreatorLounge } from "@/lib/social/creator-lounge";
import { friendsCount } from "@/lib/social/friends";
import { getReputationBonus } from "@/lib/social/profile";
import { listSnapshots } from "@/lib/social/profile-backends";
import { computeReputation } from "@/lib/social/reputation";
import { createAdminClient } from "@/lib/supabase/admin";

import { computeCreatorHealth, type CreatorHealth, type CreatorHealthSignals } from "./health";
import { buildCreatorJourney, nextMilestone, type JourneySignals, type JourneyStep } from "./journey";

/**
 * Creator Home aggregate (Feature 15 · Part 9).
 *
 * ── The rule this file exists to obey ────────────────────────────────────
 * It COMPOSES the data functions Parts 4-8 already shipped; it never forks one.
 * `getCreatorAnalytics`, `getCreatorLounge` and `computeAchievements` are
 * called here, not reimplemented, so a fix to any of them reaches the Studio
 * for free and the Studio can never quietly disagree with the screen a creator
 * saw yesterday.
 *
 * What it adds is the two things none of them could answer: TODAY versus
 * YESTERDAY, and the weekly rhythm the health engine needs.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface DailyDelta {
  today: number;
  yesterday: number;
  /** today − yesterday. A real difference between two real counts. */
  change: number;
}

export interface RecentFollower {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  followedAt: string;
}

export interface LatestPost {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  status: string;
  views: number;
  engagement: number;
  completionRate: number;
}

export interface WeeklyGoal {
  target: number;
  published: number;
  /** null when no goal is set — not zero, which would read as "goal: none met". */
  progress: number | null;
}

export interface ContentSuggestion {
  id: string;
  title: string;
  body: string;
  /** The measured fact this came from. Every suggestion has one. */
  because: string;
  href?: string;
}

export interface CreatorHome {
  analytics: CreatorAnalytics;
  lounge: CreatorLounge;
  views: DailyDelta;
  followers: DailyDelta;
  engagement: DailyDelta;
  watchThrough: { today: number; yesterday: number; change: number };
  recentFollowers: RecentFollower[];
  latest: LatestPost[];
  goal: WeeklyGoal;
  health: CreatorHealth;
  journey: JourneyStep[];
  nextStep: JourneyStep | null;
  achievements: EarnedAchievement[];
  suggestions: ContentSuggestion[];
  /** Posts waiting on a schedule — surfaced so a queue is never forgotten. */
  scheduledCount: number;
}

const DAY = 864e5;

function startOfUtcDay(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * DAY);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getCreatorHome(userId: string, weeklyGoalTarget: number): Promise<CreatorHome | null> {
  if (!hasSupabase) return null;

  const db = createAdminClient();
  const todayStart = startOfUtcDay(0);
  const yesterdayStart = startOfUtcDay(1);

  const [analytics, lounge, profile] = await Promise.all([
    getCreatorAnalytics(userId),
    getCreatorLounge(userId, 60),
    // 🔴 `verified_at` is NOT a column on `profiles` — only `is_verified` is.
    // The dated proof of verification lives on the approved request row
    // (`verification_requests.reviewed_at`, migration 0104), which is what the
    // journey reads. Selecting a column that does not exist here would have
    // failed the whole profile read, and PostgREST reports that as a resolved
    // `{ error }` rather than a throw — a silently empty dashboard.
    db
      .from("profiles")
      .select("handle, created_at, followers_count, is_verified")
      .eq("id", userId)
      .maybeSingle()
      .then((r) => r.data as ProfileRow | null, () => null),
  ]);

  const { data: postRows } = await db
    .from("posts")
    .select("id, title, thumbnail_url, created_at, status, category, views_count, likes_count, comments_count, shares_count, saves_count, completion_rate")
    .eq("publisher_id", userId)
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(1000);

  const posts = ((postRows ?? []) as PostRow[]);
  const postIds = posts.map((p) => p.id);
  const publishedPosts = posts.filter((p) => p.status === "published");

  const [views, watch, follows, recentFollowerRows, scheduled] = await Promise.all([
    dailyViewCounts(db, postIds, todayStart, yesterdayStart),
    dailyWatchCompletion(db, postIds, todayStart, yesterdayStart),
    dailyFollowCounts(db, userId, todayStart, yesterdayStart),
    recentFollowers(db, userId),
    db
      .from("posts")
      .select("id", { head: true, count: "exact" })
      .eq("publisher_id", userId)
      .eq("status", "scheduled")
      .then((r) => r.count ?? 0, () => 0),
  ]);

  // Engagement today can only be measured against rows that carry a timestamp:
  // likes/comments do, the denormalized counters do not. Comments are the one
  // engagement type with a per-row created_at reachable in a single query here,
  // so "engagement today" is comments today — and the card says "comments",
  // never "engagement", because a label has to match its query.
  const engagement = await dailyCommentCounts(db, postIds, todayStart, yesterdayStart);

  const weekStart = Date.now() - 7 * DAY;
  const publishedThisWeek = publishedPosts.filter((p) => new Date(p.created_at).getTime() >= weekStart).length;

  // The oldest reading at least 30 days old — the growth baseline. A creator
  // whose series is younger than that gets null, and the pillar abstains.
  const snapshots = await listSnapshots(userId, 40);
  const cutoff = Date.now() - 30 * DAY;
  const baseline =
    [...snapshots]
      .filter((s) => new Date(s.capturedOn).getTime() <= cutoff)
      .sort((a, b) => b.capturedOn.localeCompare(a.capturedOn))[0] ?? null;

  const health = computeCreatorHealth(buildHealthSignals(posts, analytics, lounge, baseline?.followers ?? null));
  const journeySignals = await buildJourneySignals(db, userId, posts, analytics, profile);
  const journey = buildCreatorJourney(journeySignals);

  /*
    Achievements use the SAME signals the profile page feeds them — including
    friends, collections and reputation, which are three extra reads the Studio
    would otherwise not need.

    They are made anyway, because the alternative was passing zeros for signals
    this Part happens not to have in hand, and a zero here is not a neutral
    placeholder: it renders "Connector 0/10" and "Trusted Member 0/1000" to a
    creator who has met both. A dashboard that disagrees with the profile about
    what someone has earned is worse than one that costs two more queries.
  */
  const accountAgeDays = profile?.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.created_at).getTime()) / DAY))
    : 0;

  const [friendTotal, collectionsN, repBonus] = await Promise.all([
    friendsCount(userId),
    viewableCollectionsCount(userId, userId, false),
    getReputationBonus(userId),
  ]);

  const reputation = computeReputation({
    accountAgeDays,
    posts: analytics.totals.posts,
    followers: analytics.followers,
    friends: friendTotal,
    engagementReceived:
      analytics.totals.likes + analytics.totals.comments + analytics.totals.shares + analytics.totals.saves,
    views: analytics.totals.views,
    collections: collectionsN,
    verified: Boolean(profile?.is_verified),
    bonus: repBonus,
  });

  const achievements = computeAchievements({
    accountAgeDays,
    posts: analytics.totals.posts,
    followers: analytics.followers,
    friends: friendTotal,
    likes: analytics.totals.likes,
    views: analytics.totals.views,
    collections: collectionsN,
    verified: Boolean(profile?.is_verified),
    reputationScore: reputation.score,
  });

  return {
    analytics,
    lounge,
    views,
    followers: follows,
    engagement,
    watchThrough: watch,
    recentFollowers: recentFollowerRows,
    latest: posts.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.title,
      thumbnailUrl: p.thumbnail_url,
      createdAt: p.created_at,
      status: p.status,
      views: p.views_count ?? 0,
      engagement: (p.likes_count ?? 0) + (p.comments_count ?? 0) + (p.shares_count ?? 0) + (p.saves_count ?? 0),
      completionRate: p.completion_rate ?? 0,
    })),
    goal: {
      target: weeklyGoalTarget,
      published: publishedThisWeek,
      progress: weeklyGoalTarget > 0 ? Math.min(1, publishedThisWeek / weeklyGoalTarget) : null,
    },
    health,
    journey,
    nextStep: nextMilestone(journey),
    achievements,
    suggestions: buildSuggestions(posts, analytics, lounge, health, scheduled),
    scheduledCount: scheduled,
  };
}

/* ─────────────────────────────── row shapes ─────────────────────────────── */

interface ProfileRow {
  handle: string;
  created_at: string;
  followers_count: number | null;
  is_verified: boolean | null;
}

interface PostRow {
  id: string;
  title: string;
  thumbnail_url: string | null;
  created_at: string;
  status: string;
  category: string | null;
  views_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  saves_count: number | null;
  completion_rate: number | null;
}

/* ──────────────────────────── daily comparisons ─────────────────────────── */

async function countBetween(
  q: { gte: (c: string, v: string) => { lt: (c: string, v: string) => Promise<{ count: number | null }> } },
  from: string,
  to: string,
): Promise<number> {
  try {
    const { count } = await q.gte("created_at", from).lt("created_at", to);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function dailyViewCounts(
  db: ReturnType<typeof createAdminClient>,
  postIds: string[],
  todayStart: string,
  yesterdayStart: string,
): Promise<DailyDelta> {
  if (postIds.length === 0) return { today: 0, yesterday: 0, change: 0 };
  const now = new Date().toISOString();
  const base = () => db.from("post_views").select("id", { head: true, count: "exact" }).in("post_id", postIds);
  const [today, yesterday] = await Promise.all([
    countBetween(base() as never, todayStart, now),
    countBetween(base() as never, yesterdayStart, todayStart),
  ]);
  return { today, yesterday, change: today - yesterday };
}

async function dailyCommentCounts(
  db: ReturnType<typeof createAdminClient>,
  postIds: string[],
  todayStart: string,
  yesterdayStart: string,
): Promise<DailyDelta> {
  if (postIds.length === 0) return { today: 0, yesterday: 0, change: 0 };
  const now = new Date().toISOString();
  const base = () => db.from("post_comments").select("id", { head: true, count: "exact" }).in("post_id", postIds);
  const [today, yesterday] = await Promise.all([
    countBetween(base() as never, todayStart, now),
    countBetween(base() as never, yesterdayStart, todayStart),
  ]);
  return { today, yesterday, change: today - yesterday };
}

async function dailyFollowCounts(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  todayStart: string,
  yesterdayStart: string,
): Promise<DailyDelta> {
  const now = new Date().toISOString();
  const base = () =>
    db.from("follows").select("follower_id", { head: true, count: "exact" }).eq("following_id", userId);
  const [today, yesterday] = await Promise.all([
    countBetween(base() as never, todayStart, now),
    countBetween(base() as never, yesterdayStart, todayStart),
  ]);
  return { today, yesterday, change: today - yesterday };
}

/** Mean watch-through today vs yesterday, as a percentage. Returns zeros when
 *  nothing was watched — an absent measurement, rendered as a dash. */
async function dailyWatchCompletion(
  db: ReturnType<typeof createAdminClient>,
  postIds: string[],
  todayStart: string,
  yesterdayStart: string,
): Promise<{ today: number; yesterday: number; change: number }> {
  if (postIds.length === 0) return { today: 0, yesterday: 0, change: 0 };
  try {
    const { data } = await db
      .from("post_watch_events")
      .select("watch_ms, duration_ms, created_at")
      .in("post_id", postIds)
      .gte("created_at", yesterdayStart)
      .limit(4000);

    const rows = (data ?? []) as { watch_ms: number; duration_ms: number; created_at: string }[];
    const mean = (list: typeof rows) => {
      const usable = list.filter((r) => r.duration_ms > 0);
      if (usable.length === 0) return 0;
      const sum = usable.reduce((acc, r) => acc + Math.min(1, r.watch_ms / r.duration_ms), 0);
      return Math.round((sum / usable.length) * 1000) / 10;
    };

    const today = mean(rows.filter((r) => r.created_at >= todayStart));
    const yesterday = mean(rows.filter((r) => r.created_at < todayStart));
    return { today, yesterday, change: Math.round((today - yesterday) * 10) / 10 };
  } catch {
    return { today: 0, yesterday: 0, change: 0 };
  }
}

async function recentFollowers(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<RecentFollower[]> {
  try {
    const { data } = await db
      .from("follows")
      .select("follower_id, created_at")
      .eq("following_id", userId)
      .order("created_at", { ascending: false })
      .limit(8);

    const rows = (data ?? []) as { follower_id: string; created_at: string }[];
    if (rows.length === 0) return [];

    const { data: profiles } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .in("id", rows.map((r) => r.follower_id));

    const byId = new Map(
      ((profiles ?? []) as { id: string; handle: string; display_name: string | null; avatar_url: string | null }[]).map(
        (p) => [p.id, p],
      ),
    );

    return rows
      .map((r) => {
        const p = byId.get(r.follower_id);
        if (!p) return null;
        return {
          id: p.id,
          handle: p.handle,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
          followedAt: r.created_at,
        };
      })
      .filter((r): r is RecentFollower => r !== null);
  } catch {
    return [];
  }
}

/* ─────────────────────────── health + journey inputs ────────────────────── */

function buildHealthSignals(
  posts: PostRow[],
  analytics: CreatorAnalytics,
  lounge: CreatorLounge,
  followers30dAgo: number | null,
): CreatorHealthSignals {
  const published = posts.filter((p) => p.status === "published");

  // Eight weekly buckets, most recent first.
  const weeklyPosts = Array.from({ length: 8 }, (_, i) => {
    const end = Date.now() - i * 7 * DAY;
    const start = end - 7 * DAY;
    return published.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= start && t < end;
    }).length;
  });

  const recentCutoff = Date.now() - 30 * DAY;
  const recent = published.filter((p) => new Date(p.created_at).getTime() >= recentCutoff);
  const rate = (list: PostRow[]) => {
    const views = list.reduce((s, p) => s + (p.views_count ?? 0), 0);
    if (views === 0) return 0;
    const eng = list.reduce(
      (s, p) => s + (p.likes_count ?? 0) + (p.comments_count ?? 0) + (p.shares_count ?? 0) + (p.saves_count ?? 0),
      0,
    );
    return eng / views;
  };

  const recentCategories = new Set(recent.map((p) => p.category ?? "other"));

  return {
    weeklyPosts,
    recentEngagementRate: rate(recent),
    lifetimeEngagementRate: rate(published),
    replyRate: lounge.replyRatePercent / 100,
    commentsReceived: analytics.totals.comments,
    followersNow: analytics.followers,
    // From the daily snapshot series (migration 0110), which is the only thing
    // in this product that remembers what a counter used to say. Null when no
    // reading that old exists — the growth pillar then abstains rather than
    // treating today's number as its own baseline, which would report every
    // creator as having grown by exactly zero.
    followers30dAgo,
    categoriesUsed: recentCategories.size,
    categoriesAvailable: 14,
    totalPosts: analytics.totals.posts,
  };
}

async function buildJourneySignals(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  posts: PostRow[],
  analytics: CreatorAnalytics,
  profile: ProfileRow | null,
): Promise<JourneySignals> {
  const published = [...posts]
    .filter((p) => p.status === "published")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const first = published[0] ?? null;
  const top = [...published].sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0))[0] ?? null;

  const [firstFollow, sounds, verifiedAt] = await Promise.all([
    db
      .from("follows")
      .select("created_at")
      .eq("following_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .then((r) => ((r.data ?? []) as { created_at: string }[])[0]?.created_at ?? null, () => null),
    db
      .from("sounds")
      .select("created_at")
      .eq("created_by", userId)
      .order("created_at", { ascending: true })
      .then((r) => (r.data ?? []) as { created_at: string }[], () => []),
    // The real, dated proof that verification happened (migration 0104).
    // `profiles.is_verified` says THAT it did; only this row says WHEN.
    db
      .from("verification_requests")
      .select("reviewed_at")
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("reviewed_at", { ascending: false })
      .limit(1)
      .then((r) => ((r.data ?? []) as { reviewed_at: string | null }[])[0]?.reviewed_at ?? null, () => null),
  ]);

  return {
    joinedAt: profile?.created_at ?? new Date().toISOString(),
    firstPost: first
      ? { id: first.id, title: first.title, createdAt: first.created_at, thumbnailUrl: first.thumbnail_url }
      : null,
    topPost: top
      ? {
          id: top.id,
          title: top.title,
          views: top.views_count ?? 0,
          createdAt: top.created_at,
          thumbnailUrl: top.thumbnail_url,
        }
      : null,
    totalViews: analytics.totals.views,
    followers: analytics.followers,
    totalPosts: analytics.totals.posts,
    firstFollowerAt: firstFollow,
    isVerified: Boolean(profile?.is_verified),
    verifiedAt,
    soundsPublished: sounds.length,
    firstSoundAt: sounds[0]?.created_at ?? null,
  };
}

/* ────────────────────────────── suggestions ─────────────────────────────── */

/**
 * 🔴 Every suggestion carries the measurement it came from, in `because`.
 *
 * That is not decoration. A suggestion a creator cannot trace back to a real
 * number is indistinguishable from a generic content-marketing tip, and this
 * product does not ship invented insight. If a fact cannot be stated, the
 * suggestion is not generated.
 */
function buildSuggestions(
  posts: PostRow[],
  analytics: CreatorAnalytics,
  lounge: CreatorLounge,
  health: CreatorHealth,
  scheduledCount: number,
): ContentSuggestion[] {
  const out: ContentSuggestion[] = [];
  const published = posts.filter((p) => p.status === "published");

  if (lounge.unanswered.length > 0) {
    out.push({
      id: "answer-questions",
      title: "Answer the questions on your posts",
      body: "Replying is the cheapest engagement there is, and viewers who get a reply come back.",
      because: `${lounge.unanswered.length} unanswered ${lounge.unanswered.length === 1 ? "question" : "questions"} on your posts.`,
      href: "/account/creator-lounge",
    });
  }

  // Best category by views per post, where there is enough to compare.
  const byCategory = new Map<string, { views: number; posts: number }>();
  for (const p of published) {
    const key = p.category ?? "other";
    const prev = byCategory.get(key) ?? { views: 0, posts: 0 };
    byCategory.set(key, { views: prev.views + (p.views_count ?? 0), posts: prev.posts + 1 });
  }
  const ranked = [...byCategory.entries()]
    .filter(([, v]) => v.posts >= 2)
    .map(([category, v]) => ({ category, avg: v.views / v.posts, posts: v.posts }))
    .sort((a, b) => b.avg - a.avg);

  if (ranked.length >= 2) {
    const best = ranked[0]!;
    out.push({
      id: "lean-into-category",
      title: `More ${categoryLabel(best.category)}`,
      body: "This is the topic your audience responds to most. It is worth another one.",
      because: `${categoryLabel(best.category)} averages ${Math.round(best.avg).toLocaleString()} views across ${best.posts} posts — your best category.`,
    });
  }

  if (analytics.discovery.retention > 0 && analytics.discovery.retention < 40) {
    out.push({
      id: "shorter-openings",
      title: "Tighten your first few seconds",
      body: "Most viewers are leaving early. Opening on the payoff rather than the setup is the usual fix.",
      because: `Average watch-through is ${analytics.discovery.retention}% across your posts.`,
    });
  }

  if (scheduledCount === 0 && health.pillars.find((p) => p.key === "consistency")?.score !== null) {
    out.push({
      id: "queue-something",
      title: "Put something in the queue",
      body: "A scheduled post keeps a quiet week from becoming a gap your audience notices.",
      because: "Nothing is scheduled right now.",
      href: "/studio/calendar",
    });
  }

  for (const s of health.suggestions.slice(0, 2)) {
    out.push({
      id: `health-${s.pillar}`,
      title: s.title,
      body: s.body,
      because: health.pillars.find((p) => p.key === s.pillar)?.detail ?? "",
      href: "/studio/journey",
    });
  }

  return out.slice(0, 5);
}
