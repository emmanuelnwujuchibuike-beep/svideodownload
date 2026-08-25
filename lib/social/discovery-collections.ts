import { createAdminClient } from "@/lib/supabase/admin";

import { flagsOf, isAccountVisibleTo, relationTo } from "./account-visibility";
import { friendIdSet } from "./friend-ids";
import type { OrbitCard } from "./orbits-catalogue";
import { postHref } from "./post-url";

/**
 * Video Collections (Feature 15 Part 8) — curated rails computed from REAL
 * signals only (hot_score, momentum_score, completion_rate, friends' own
 * reactions). No "Weekend Picks" here: this app collects no day-of-week
 * engagement signal, so a weekend-labeled rail would just be Trending Today
 * wearing a different name — the same "label doesn't match the query" defect
 * class `rankForYou`'s history already warns against (see home-feed.ts). Four
 * genuinely distinct collections instead.
 *
 * 🔴 Deliberately its own file, NOT lib/social/collections.ts — that name is
 * already taken by an unrelated, pre-existing feature (user-curated saved
 * post boards, `collections`/`collection_items` tables). Confused the two
 * once already this session (a `Write` clobbered the real file before this
 * split existed) — named distinctly so it can't happen again.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type VideoCollectionId = "trending_today" | "hidden_gems" | "new_this_week" | "friends_favorites";

export interface VideoCollection {
  id: VideoCollectionId;
  label: string;
  description: string;
  cards: OrbitCard[];
}

interface CandidateRow {
  id: string;
  publisher_id: string;
  title: string;
  category: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  views_count: number;
  likes_count: number;
  saves_count: number;
  shares_count: number;
  comments_count: number;
  hot_score: number;
  momentum_score: number | null;
  created_at: string;
}

const CANDIDATE_SELECT =
  "id, publisher_id, title, category, thumbnail_url, media_url, views_count, likes_count, saves_count, shares_count, comments_count, hot_score, momentum_score, created_at";

function toCard(r: CandidateRow, subtitle?: string): OrbitCard {
  return {
    id: r.id,
    kind: "post",
    href: postHref({ id: r.id, category: r.category, createdAt: r.created_at }),
    title: r.title,
    subtitle,
    imageUrl: r.thumbnail_url ?? r.media_url,
  };
}

/**
 * A single privacy-filtered candidate window (last 30 days, published+public),
 * shared by Trending Today / Hidden Gems / New This Week — one query and one
 * privacy pass instead of three, since all three are different SORTS/FILTERS
 * over the same real underlying pool. Mirrors the exact suspended/hidden/
 * blocked/opted-out filter `lib/social/feed.ts`'s `loadFeed` already applies.
 */
async function loadCandidates(viewerId: string | null): Promise<CandidateRow[]> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data } = await db
    .from("posts")
    .select(CANDIDATE_SELECT)
    .eq("status", "published")
    .eq("visibility", "public")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(400);
  let rows = (data as unknown as CandidateRow[]) ?? [];
  if (rows.length === 0) return [];

  const publisherIds = [...new Set(rows.map((r) => r.publisher_id))];
  const [{ data: profs }, { data: privs }, blocks, friends] = await Promise.all([
    db.from("profiles").select("id, is_suspended, is_hidden").in("id", publisherIds),
    db.from("privacy_settings").select("user_id, show_in_recommendations").in("user_id", publisherIds),
    viewerId
      ? db.from("blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
      : Promise.resolve({ data: [] as { blocker_id: string; blocked_id: string }[] }),
    friendIdSet(viewerId),
  ]);

  const profRows = (profs ?? []) as { id: string; is_suspended: boolean; is_hidden: boolean }[];
  const invisible = new Set(
    profRows.filter((p) => !isAccountVisibleTo(flagsOf(p), relationTo(p.id, viewerId, friends))).map((p) => p.id),
  );
  const optedOut = new Set(
    ((privs ?? []) as { user_id: string; show_in_recommendations: boolean }[])
      .filter((p) => !p.show_in_recommendations)
      .map((p) => p.user_id),
  );
  const blocked = new Set<string>();
  for (const b of (blocks.data ?? []) as { blocker_id: string; blocked_id: string }[]) {
    blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
  }

  rows = rows.filter(
    (r) => !invisible.has(r.publisher_id) && !optedOut.has(r.publisher_id) && !blocked.has(r.publisher_id),
  );
  return rows;
}

function trendingToday(candidates: CandidateRow[], limit: number): OrbitCard[] {
  const dayMs = 24 * 3_600_000;
  let pool = candidates.filter((r) => Date.now() - new Date(r.created_at).getTime() < dayMs);
  // A quiet day for new posts shouldn't make the rail empty — widen to 48h
  // rather than show nothing, still clearly "recent", just not literally today.
  if (pool.length < 4) pool = candidates.filter((r) => Date.now() - new Date(r.created_at).getTime() < 2 * dayMs);
  return [...pool]
    .sort((a, b) => b.hot_score - a.hot_score)
    .slice(0, limit)
    .map((r) => toCard(r));
}

/**
 * High engagement RELATIVE to reach, not high engagement in absolute terms —
 * a post with fewer views than the pool's median but an above-average
 * likes+saves+shares+comments ratio. Real "you'd have missed this" content,
 * not just "everything with under 100 views" (which would mostly be genuinely
 * unremarkable, not hidden gems).
 */
function hiddenGems(candidates: CandidateRow[], limit: number): OrbitCard[] {
  if (candidates.length < 6) return [];
  const sortedViews = [...candidates.map((r) => r.views_count)].sort((a, b) => a - b);
  const medianViews = sortedViews[Math.floor(sortedViews.length / 2)] ?? 0;
  const rate = (r: CandidateRow) =>
    (r.likes_count + r.saves_count * 2 + r.shares_count * 3 + r.comments_count * 2) / Math.max(1, r.views_count);
  return [...candidates]
    .filter((r) => r.views_count <= medianViews && r.views_count > 0)
    .sort((a, b) => rate(b) - rate(a))
    .slice(0, limit)
    .map((r) => toCard(r, "Underrated"));
}

function newThisWeek(candidates: CandidateRow[], limit: number): OrbitCard[] {
  const weekMs = 7 * 864e5;
  const pool = candidates.filter((r) => Date.now() - new Date(r.created_at).getTime() < weekMs);
  return [...pool]
    .sort((a, b) => (b.momentum_score ?? 0) - (a.momentum_score ?? 0) || b.hot_score - a.hot_score)
    .slice(0, limit)
    .map((r) => toCard(r));
}

/** Posts the viewer's OWN friends liked or saved — not the viewer's own
 *  activity, not strangers'. Absent (not faked) for a signed-out viewer or
 *  one with no friends. */
async function friendsFavorites(viewerId: string | null, limit: number): Promise<OrbitCard[]> {
  if (!viewerId) return [];
  const db = createAdminClient();
  const friends = await friendIdSet(viewerId);
  if (friends.size === 0) return [];

  const { data: reactions } = await db
    .from("post_reactions")
    .select("post_id, type")
    .in("user_id", [...friends])
    .in("type", ["like", "save"])
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (reactions ?? []) as { post_id: string; type: string }[];
  if (rows.length === 0) return [];

  const weightByPost = new Map<string, number>();
  for (const r of rows) {
    weightByPost.set(r.post_id, (weightByPost.get(r.post_id) ?? 0) + (r.type === "save" ? 2 : 1));
  }
  const topIds = [...weightByPost.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2).map(([id]) => id);
  if (topIds.length === 0) return [];

  const { data: posts } = await db
    .from("posts")
    .select(CANDIDATE_SELECT)
    .in("id", topIds)
    .eq("status", "published")
    .eq("visibility", "public");
  const byId = new Map(((posts as unknown as CandidateRow[]) ?? []).map((p) => [p.id, p]));

  return topIds
    .map((id) => byId.get(id))
    .filter((r): r is CandidateRow => !!r)
    .slice(0, limit)
    .map((r) => toCard(r, "Liked by your friends"));
}

export async function getVideoCollections(viewerId: string | null, limitPerCollection = 10): Promise<VideoCollection[]> {
  if (!hasSupabase) return [];
  const [candidates, friendsCards] = await Promise.all([
    loadCandidates(viewerId),
    friendsFavorites(viewerId, limitPerCollection),
  ]);

  const collections: VideoCollection[] = [
    {
      id: "trending_today",
      label: "Trending Today",
      description: "The hottest posts from the last day",
      cards: trendingToday(candidates, limitPerCollection),
    },
    {
      id: "hidden_gems",
      label: "Hidden Gems",
      description: "High engagement, low reach — worth a look",
      cards: hiddenGems(candidates, limitPerCollection),
    },
    {
      id: "new_this_week",
      label: "New This Week",
      description: "Fresh posts already gaining momentum",
      cards: newThisWeek(candidates, limitPerCollection),
    },
  ];
  if (friendsCards.length > 0) {
    collections.push({
      id: "friends_favorites",
      label: "Friends' Favorites",
      description: "Posts your friends liked or saved",
      cards: friendsCards,
    });
  }
  // Never show an empty rail — a collection with nothing real to show is
  // omitted, not padded.
  return collections.filter((c) => c.cards.length > 0);
}
