import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRIEND ACTIVITY — who that you follow engaged with this post (Part 3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The data source Social Pulse™ was built for in Part 1 and never had. That
 * component shipped with a deliberately empty event list and this comment on it:
 * "the component is wired, the data source is the piece that does not exist
 * yet." This is that piece.
 *
 * ── 🔴 Every event here is a ROW THAT EXISTS ───────────────────────────────
 *
 * Fabricated social proof has been declined three times on this project and the
 * Reality Ledger fails the build on invented scale claims. So this reads real
 * `post_reactions`, `reposts` and `post_comments` rows, filtered to people the
 * viewer actually follows, and returns nothing when there are none. An empty
 * result is the correct and common state — most reels will have one.
 *
 * There is deliberately NO "watched" kind. The brief asks for "5 friends watched
 * this" and there is no per-viewer view ledger to answer it from — only a
 * `views_count` integer. Inventing the names would be exactly the failure above,
 * and building the ledger is a privacy decision (it records who watched what),
 * not a schema chore.
 *
 * ── Why one batched module and not three call sites ────────────────────────
 *
 * The same shape `followedReposters` already uses: `IN (postIds) AND user_id IN
 * (followingIds)`, one profile lookup for the union of actors, grouped in
 * memory. A page of N posts costs a fixed number of round-trips rather than N —
 * the difference between a feed query and a feed outage. It runs inside the same
 * `Promise.all` as the repost badge, so it adds no wall-clock time to a page.
 *
 * ── Fail-open to nothing ───────────────────────────────────────────────────
 *
 * Every read is wrapped and degrades to an empty map. A missing migration, an
 * RLS change or a slow table costs the viewer a Pulse card, never their feed.
 */

export type PulseActivityKind = "like" | "repost" | "comment";

export interface PulseProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface PulseActor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  kind: PulseActivityKind;
}

export interface PulseActivity {
  /** Named people, newest first, capped — see MAX_ACTORS. */
  actors: PulseActor[];
  /** How many followed people engaged in total, including the ones not named. */
  total: number;
}

/**
 * How many people are ever NAMED.
 *
 * Three is not an arbitrary cap. Social Pulse shows one card at a time and each
 * one costs a few seconds of a viewer's attention, so a reel with fifteen
 * engaged friends must not queue fifteen cards — past about three the value is
 * in the NUMBER, which Friend Energy™ shows as a single static line instead.
 */
export const MAX_ACTORS = 3;

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface ActorRow {
  post_id: string;
  user_id: string;
  kind: PulseActivityKind;
}

type ProfileRow = PulseProfileRow;

/**
 * Group raw rows into per-post activity.
 *
 * Pure, and separated from the queries on purpose: the ordering, de-duplication
 * and capping rules below are the part with actual behaviour in them, and they
 * are the part worth testing across the awkward cases (the same friend liking
 * AND reposting, the viewer's own row, more actors than the cap).
 */
export function groupPulseActivity(
  rows: ActorRow[],
  profiles: Map<string, ProfileRow>,
  viewerId: string | null,
): Map<string, PulseActivity> {
  const out = new Map<string, PulseActivity>();
  const byPost = new Map<string, ActorRow[]>();

  for (const r of rows) {
    // 🔴 Never show the viewer their own action back to them. "You liked this"
    // is not social proof, and seeing yourself in a Pulse card reads as a bug.
    if (viewerId && r.user_id === viewerId) continue;
    const arr = byPost.get(r.post_id) ?? [];
    arr.push(r);
    byPost.set(r.post_id, arr);
  }

  for (const [postId, list] of byPost) {
    /*
      One person counts ONCE, however many ways they engaged.

      Someone who liked a reel and then reposted it is one friend, not two, and
      counting them twice inflates "3 friends" out of two people — a small lie,
      but the same kind as the invented ones this module exists to avoid. The
      FIRST row for a person wins, and rows arrive newest-first, so what is kept
      is their most recent action, which is the one worth reporting.
    */
    const seen = new Set<string>();
    const actors: PulseActor[] = [];
    for (const r of list) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      const p = profiles.get(r.user_id);
      // A profile with no handle cannot be linked or named, so it is counted in
      // the total but never named — better than rendering "@undefined".
      if (!p?.handle) continue;
      if (actors.length < MAX_ACTORS) {
        actors.push({
          handle: p.handle,
          displayName: p.display_name || p.handle,
          avatarUrl: p.avatar_url,
          kind: r.kind,
        });
      }
    }
    if (seen.size === 0) continue;
    out.set(postId, { actors, total: seen.size });
  }
  return out;
}

/**
 * Which people the viewer follows engaged with each of these posts.
 *
 * `followingIds` is already resolved by the feed for the repost badge, so this
 * takes it rather than re-querying — the caller has it in hand and a second
 * fetch of the same list is pure waste.
 */
export async function pulseActivityForPosts(
  postIds: string[],
  followingIds: string[],
  viewerId: string | null,
): Promise<Map<string, PulseActivity>> {
  const out = new Map<string, PulseActivity>();
  if (!hasSupabase || postIds.length === 0 || followingIds.length === 0) return out;

  try {
    const db = createAdminClient();

    /*
      Three reads in parallel, each already narrowed by BOTH ids — so the
      database does the filtering, not this process. Ordered newest-first
      because `groupFriendActivity` keeps the first row per person and that
      should be their most recent action.

      Each is caught individually: `reposts` and the `emotion` column arrived in
      later migrations, and one unmigrated table must not blank out the other
      two. This is the same tolerance `fetchReactionRows` already applies for
      the same reason.
    */
    const safe = async <T>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
      try {
        const { data } = await p;
        return data ?? [];
      } catch {
        return [];
      }
    };

    const [likeRows, repostRows, commentRows] = await Promise.all([
      safe<{ post_id: string; user_id: string }>(
        db
          .from("post_reactions")
          .select("post_id, user_id")
          .eq("type", "like")
          .in("post_id", postIds)
          .in("user_id", followingIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
      safe<{ post_id: string; user_id: string }>(
        db
          .from("reposts")
          .select("post_id, user_id")
          .in("post_id", postIds)
          .in("user_id", followingIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
      safe<{ post_id: string; author_id: string }>(
        db
          .from("post_comments")
          .select("post_id, author_id")
          .eq("status", "visible")
          .in("post_id", postIds)
          .in("author_id", followingIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
    ]);

    const rows: ActorRow[] = [
      ...repostRows.map((r) => ({ post_id: r.post_id, user_id: r.user_id, kind: "repost" as const })),
      ...commentRows.map((r) => ({ post_id: r.post_id, user_id: r.author_id, kind: "comment" as const })),
      ...likeRows.map((r) => ({ post_id: r.post_id, user_id: r.user_id, kind: "like" as const })),
    ];
    if (rows.length === 0) return out;

    /*
      Reposts first, then comments, then likes — the order the arrays are
      concatenated in IS the priority, because the de-dupe keeps the first row
      per person. Someone who both liked and reposted is reported as having
      reposted: it is the stronger, rarer and more useful signal, and "David
      reposted this" tells a viewer more than "David liked this".
    */

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const profs = await safe<ProfileRow>(
      db.from("profiles").select("id, handle, display_name, avatar_url").in("id", userIds),
    );
    const byId = new Map(profs.map((p) => [p.id, p]));

    return groupPulseActivity(rows, byId, viewerId);
  } catch {
    /* not migrated / unavailable — an empty map is a correct, quiet result */
    return out;
  }
}
