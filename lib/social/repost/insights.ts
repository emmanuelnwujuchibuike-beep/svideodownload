import { createAdminClient } from "@/lib/supabase/admin";

import { friendIdSet } from "../friend-ids";
import type { RepostAudience } from "./audience";
import { countsForReposter, countsForReposts, emptyCounts, type AttributionCounts } from "./attribution";
import { recommendationReputation, type ReputationResult } from "./reputation";

/**
 * Repost analytics — reposter-side and creator-side (Feature 15 · Part 4).
 *
 * ── Two audiences, two different privacy answers ─────────────────────────
 * A REPOSTER may see what their own recommendation caused, as counts.
 * A CREATOR may see who recommended them **only where that was already
 * public** — a `public` repost is on the reposter's profile and is not a
 * secret. A friends-only or private repost never appears in creator analytics,
 * even as an anonymous tally, because on a small post a tally plus a timestamp
 * identifies the person.
 *
 * ── "Real time", honestly ────────────────────────────────────────────────
 * The brief asks for real-time updates. These are counted per request from the
 * ledger, so a panel is accurate the moment it is opened. A live subscription
 * per open panel is a per-view cost that belongs behind a measurement, and it
 * is named as tranche 3 in the Part 4 doc rather than claimed here.
 *
 * ── Not built, and why ───────────────────────────────────────────────────
 * Countries and cities: no geo column exists on any of these tables, and adding
 * one to an engagement ledger is a privacy decision, not an analytics task.
 * Watch time: no per-viewer watch ledger keyed to a repost exists.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface RepostInsights {
  repostId: string;
  postId: string;
  createdAt: string;
  audience: RepostAudience;
  caption: string | null;
  counts: AttributionCounts;
  /** Distinct people the reposter is friends with who saw it. A COUNT, never names. */
  friendsReached: number;
  /** False when nothing has happened yet — the honest, common state. */
  hasData: boolean;
}

/** One member's own repost of one post. Returns null when they haven't reposted it. */
export async function repostInsights(userId: string, postId: string): Promise<RepostInsights | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("reposts")
      .select("id, created_at, caption, audience")
      .eq("user_id", userId)
      .eq("post_id", postId)
      .maybeSingle();
    // Pre-0116 the audience column is missing; fall back to the columns that exist.
    const row = error
      ? (
          await db
            .from("reposts")
            .select("id, created_at, caption")
            .eq("user_id", userId)
            .eq("post_id", postId)
            .maybeSingle()
        ).data
      : data;
    if (!row) return null;

    const repostId = row.id as string;
    const [counts, friendsReached] = await Promise.all([
      countsForReposts([repostId]).then((m) => m.get(repostId) ?? emptyCounts()),
      friendsReachedBy(db, repostId, userId),
    ]);

    return {
      repostId,
      postId,
      createdAt: row.created_at as string,
      audience: ((row as { audience?: string }).audience ?? "public") as RepostAudience,
      caption: (row.caption as string | null) ?? null,
      counts,
      friendsReached,
      hasData: Object.values(counts).some((n) => n > 0),
    };
  } catch {
    return null;
  }
}

/**
 * How many of the reposter's own friends this repost reached.
 *
 * Reads actor ids server-side and returns a COUNT. The ids never leave this
 * function — see the module note on `attribution.ts`.
 */
async function friendsReachedBy(
  db: ReturnType<typeof createAdminClient>,
  repostId: string,
  userId: string,
): Promise<number> {
  try {
    const [{ data }, friends] = await Promise.all([
      db.from("repost_attributions").select("actor_id").eq("repost_id", repostId).in("event", ["impression", "open"]),
      friendIdSet(userId),
    ]);
    const seen = new Set<string>();
    for (const r of (data ?? []) as { actor_id: string | null }[]) {
      if (r.actor_id && friends.has(r.actor_id)) seen.add(r.actor_id);
    }
    return seen.size;
  } catch {
    return 0;
  }
}

/** Recommendation Circle™ for a member, derived per read and private to them. */
export async function reposterReputation(userId: string): Promise<ReputationResult> {
  const { counts, reposts, distinctCreators } = await countsForReposter(userId);
  return recommendationReputation({
    reposts,
    impressions: counts.impression,
    opens: counts.open,
    positiveEngagements: counts.like + counts.comment + counts.save,
    chainReposts: counts.repost,
    creatorFollows: counts.follow_creator,
    distinctCreators,
  });
}

export interface TopReposter {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Impressions their repost generated. */
  reach: number;
  hasCaption: boolean;
}

export interface CreatorRepostInsights {
  postId: string;
  /** Public reposts only — the number a creator can act on and the only one they may see. */
  publicReposts: number;
  /** Reposts carrying a recommendation caption. */
  quoteReposts: number;
  counts: AttributionCounts;
  topReposters: TopReposter[];
  /** Openers per person reached, 0–1. Null when nothing has been shown yet. */
  openRate: number | null;
  /** Comments per open — the brief's "conversation rate". Null without opens. */
  conversationRate: number | null;
  hasData: boolean;
}

/**
 * What reposting did for one of the creator's own posts.
 *
 * 🔴 `.eq("audience", "public")` is the load-bearing line. Without it a creator
 * would learn that four people reposted privately — which, on a post with five
 * viewers, names them.
 */
export async function creatorRepostInsights(creatorId: string, postId: string): Promise<CreatorRepostInsights | null> {
  const empty: CreatorRepostInsights = {
    postId,
    publicReposts: 0,
    quoteReposts: 0,
    counts: emptyCounts(),
    topReposters: [],
    openRate: null,
    conversationRate: null,
    hasData: false,
  };
  if (!hasSupabase) return empty;
  try {
    const db = createAdminClient();
    const { data: post } = await db.from("posts").select("publisher_id").eq("id", postId).maybeSingle();
    if (!post || post.publisher_id !== creatorId) return null; // not their post: no data, no 404 oracle

    const query = (cols: string, publicOnly: boolean) => {
      let q = db.from("reposts").select(cols).eq("post_id", postId);
      if (publicOnly) q = q.eq("audience", "public");
      return q.order("created_at", { ascending: false }).limit(200);
    };
    // Pre-0116 there is no audience column — and also no private reposts, since
    // nothing could have written one. Falling back to every row is correct.
    const withAudience = await query("id, user_id, caption", true);
    const rows = (withAudience.error
      ? ((await query("id, user_id, caption", false)).data ?? [])
      : (withAudience.data ?? [])) as unknown as { id: string; user_id: string; caption: string | null }[];
    if (rows.length === 0) return empty;

    const [perRepost, { data: profs }] = await Promise.all([
      countsForReposts(rows.map((r) => r.id)),
      db
        .from("profiles")
        .select("id, handle, display_name, avatar_url")
        .in("id", [...new Set(rows.map((r) => r.user_id))]),
    ]);
    const profById = new Map(
      ((profs ?? []) as { id: string; handle: string; display_name: string | null; avatar_url: string | null }[]).map(
        (p) => [p.id, p],
      ),
    );

    const counts = emptyCounts();
    const topReposters: TopReposter[] = [];
    for (const r of rows) {
      const c = perRepost.get(r.id) ?? emptyCounts();
      for (const k of Object.keys(counts) as (keyof AttributionCounts)[]) counts[k] += c[k];
      const p = profById.get(r.user_id);
      if (p?.handle) {
        topReposters.push({
          userId: r.user_id,
          handle: p.handle,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
          reach: c.impression,
          hasCaption: !!r.caption,
        });
      }
    }
    topReposters.sort((a, b) => b.reach - a.reach || a.handle.localeCompare(b.handle));

    return {
      postId,
      publicReposts: rows.length,
      quoteReposts: rows.filter((r) => !!r.caption).length,
      counts,
      topReposters: topReposters.slice(0, 10),
      openRate: counts.impression > 0 ? counts.open / counts.impression : null,
      conversationRate: counts.open > 0 ? counts.comment / counts.open : null,
      hasData: Object.values(counts).some((n) => n > 0),
    };
  } catch {
    return empty;
  }
}
