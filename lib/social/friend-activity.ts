import { createAdminClient } from "@/lib/supabase/admin";

import type { FriendProfile } from "./friends";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

type Db = ReturnType<typeof createAdminClient>;

export type FriendActivityKind = "post" | "story" | "like" | "follow";

export interface FriendActivityEntry {
  kind: FriendActivityKind;
  createdAt: string;
  /** The friend who did the thing. */
  actor: FriendProfile;
  postId?: string;
  postTitle?: string | null;
  mediaKind?: string | null;
  /** The creator a friend started following (only set for kind "follow"). */
  target?: FriendProfile;
}

interface RawEntry {
  kind: FriendActivityKind;
  createdAt: string;
  actorId: string;
  postId?: string;
  postTitle?: string | null;
  mediaKind?: string | null;
  targetId?: string;
}

interface ProfileRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
}

function toProfile(r: ProfileRow): FriendProfile {
  return {
    id: r.id,
    handle: r.handle ?? "",
    displayName: r.display_name || (r.handle ? `@${r.handle}` : "Frenz user"),
    avatarUrl: r.avatar_url,
    isVerified: !!r.is_verified,
  };
}

/**
 * Home's "Friend Activity" module — the spec's own "most important module".
 * Four honest, relationship-first signals built entirely from tables that
 * already exist (no migration): friends' public posts, friends' active
 * stories, friends liking one of YOUR posts, and friends starting to follow
 * someone new (excluding "followed you" — that's already a notification, not
 * a discovery signal). Each query is independently best-effort — one failing
 * table contributes nothing rather than blanking the whole module — and the
 * merged, time-sorted result caps at 2 entries per friend so one very active
 * friend can't flood the module, the same diversity-cap philosophy
 * `home-feed.ts` already applies to posts.
 */
export async function getFriendActivity(viewerId: string, limit = 8): Promise<FriendActivityEntry[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data: fr } = await db
      .from("friendships")
      .select("user_low, user_high")
      .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`)
      .limit(500);
    let friendIds = ((fr ?? []) as { user_low: string; user_high: string }[]).map((f) =>
      f.user_low === viewerId ? f.user_high : f.user_low,
    );
    if (friendIds.length === 0) return [];

    // A muted creator's posts already stop appearing in the muter's own MAIN
    // feed (`home-feed.ts` excludes `muted_creators` there) — this module
    // must honor the same choice, not quietly resurface a muted friend's
    // posts/likes/stories/follows just because they're also a friend.
    try {
      const { data: mutes } = await db.from("muted_creators").select("muted_id").eq("muter_id", viewerId);
      const muted = new Set(((mutes ?? []) as { muted_id: string }[]).map((m) => m.muted_id));
      if (muted.size > 0) friendIds = friendIds.filter((id) => !muted.has(id));
      if (friendIds.length === 0) return [];
    } catch {
      /* best-effort against migration 0035 not being applied yet */
    }

    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const [posts, stories, likes, follows] = await Promise.all([
      friendPosts(db, friendIds, since),
      friendStories(db, friendIds),
      friendLikes(db, viewerId, friendIds, since),
      friendFollows(db, viewerId, friendIds, since),
    ]);

    const raw = [...posts, ...stories, ...likes, ...follows];
    if (raw.length === 0) return [];

    // Friends themselves only need a suspension check (an existing friendship
    // already implies trust — same convention `friendsOverview` uses); a
    // "follow" target is an arbitrary third-party creator, so it gets the
    // stricter public+non-suspended discovery filter.
    const actorIds = [...new Set(raw.map((r) => r.actorId))];
    const targetIds = [...new Set(raw.map((r) => r.targetId).filter((x): x is string => !!x))];
    const [actors, targets] = await Promise.all([
      loadFriendProfiles(db, actorIds),
      loadPublicProfiles(db, targetIds),
    ]);

    const entries: FriendActivityEntry[] = [];
    for (const r of raw) {
      const actor = actors.get(r.actorId);
      if (!actor) continue;
      if (r.targetId && !targets.has(r.targetId)) continue;
      entries.push({
        kind: r.kind,
        createdAt: r.createdAt,
        actor,
        postId: r.postId,
        postTitle: r.postTitle,
        mediaKind: r.mediaKind,
        target: r.targetId ? targets.get(r.targetId) : undefined,
      });
    }
    return capPerFriend(entries, limit);
  } catch {
    return [];
  }
}

/**
 * Sorts newest-first and caps at `maxPerFriend` (default 2) entries per
 * friend before applying the overall `limit` — so the module always reads as
 * "several friends did things", never "one friend's whole day". Exported pure
 * (no DB) so it's covered by a standalone logic test, the same verification
 * approach `rankForYou` (home-feed.ts) uses for its non-trivial ordering.
 */
export function capPerFriend(entries: FriendActivityEntry[], limit: number, maxPerFriend = 2): FriendActivityEntry[] {
  const sorted = [...entries].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const perFriend = new Map<string, number>();
  const capped: FriendActivityEntry[] = [];
  for (const e of sorted) {
    const n = perFriend.get(e.actor.id) ?? 0;
    if (n >= maxPerFriend) continue;
    perFriend.set(e.actor.id, n + 1);
    capped.push(e);
    if (capped.length >= limit) break;
  }
  return capped;
}

async function friendPosts(db: Db, friendIds: string[], since: string): Promise<RawEntry[]> {
  try {
    const { data } = await db
      .from("posts")
      .select("id, publisher_id, title, media_kind, created_at")
      .in("publisher_id", friendIds)
      .eq("status", "published")
      .eq("visibility", "public")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data ?? []) as { id: string; publisher_id: string; title: string | null; media_kind: string | null; created_at: string }[]).map(
      (p) => ({ kind: "post" as const, createdAt: p.created_at, actorId: p.publisher_id, postId: p.id, postTitle: p.title, mediaKind: p.media_kind }),
    );
  } catch {
    return [];
  }
}

/** One entry per friend — their single most recent active story. */
async function friendStories(db: Db, friendIds: string[]): Promise<RawEntry[]> {
  try {
    const { data } = await db
      .from("stories")
      .select("user_id, created_at")
      .in("user_id", friendIds)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    const seen = new Set<string>();
    const out: RawEntry[] = [];
    for (const s of (data ?? []) as { user_id: string; created_at: string }[]) {
      if (seen.has(s.user_id)) continue;
      seen.add(s.user_id);
      out.push({ kind: "story", createdAt: s.created_at, actorId: s.user_id });
    }
    return out;
  } catch {
    return [];
  }
}

async function friendLikes(db: Db, viewerId: string, friendIds: string[], since: string): Promise<RawEntry[]> {
  try {
    const { data: own } = await db
      .from("posts")
      .select("id, title")
      .eq("publisher_id", viewerId)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(30);
    const ownRows = (own ?? []) as { id: string; title: string | null }[];
    if (ownRows.length === 0) return [];
    const titleById = new Map(ownRows.map((p) => [p.id, p.title]));

    const { data } = await db
      .from("post_reactions")
      .select("post_id, user_id, created_at")
      .eq("type", "like")
      .in("post_id", ownRows.map((p) => p.id))
      .in("user_id", friendIds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data ?? []) as { post_id: string; user_id: string; created_at: string }[]).map((r) => ({
      kind: "like" as const,
      createdAt: r.created_at,
      actorId: r.user_id,
      postId: r.post_id,
      postTitle: titleById.get(r.post_id) ?? null,
    }));
  } catch {
    return [];
  }
}

/** A friend following someone new — excludes them following YOU (that's a notification, not discovery). */
async function friendFollows(db: Db, viewerId: string, friendIds: string[], since: string): Promise<RawEntry[]> {
  try {
    const { data } = await db
      .from("follows")
      .select("follower_id, following_id, created_at")
      .in("follower_id", friendIds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data ?? []) as { follower_id: string; following_id: string; created_at: string }[])
      .filter((f) => f.following_id !== viewerId)
      .map((f) => ({ kind: "follow" as const, createdAt: f.created_at, actorId: f.follower_id, targetId: f.following_id }));
  } catch {
    return [];
  }
}

async function loadFriendProfiles(db: Db, ids: string[]): Promise<Map<string, FriendProfile>> {
  if (ids.length === 0) return new Map();
  const { data } = await db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, is_verified, is_suspended")
    .in("id", ids);
  const out = new Map<string, FriendProfile>();
  for (const r of (data ?? []) as (ProfileRow & { is_suspended: boolean })[]) {
    // Checks `is_suspended` only, deliberately: every id here is already one of
    // the viewer's friends, and an admin hide (0082) is friends-only rather than
    // a silencing — so a hidden friend belongs in their friends' activity feed.
    if (r.is_suspended) continue;
    out.set(r.id, toProfile(r));
  }
  return out;
}

async function loadPublicProfiles(db: Db, ids: string[]): Promise<Map<string, FriendProfile>> {
  if (ids.length === 0) return new Map();
  const { data } = await db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, is_verified, is_suspended, is_hidden, visibility")
    .in("id", ids);
  const out = new Map<string, FriendProfile>();
  for (const r of (data ?? []) as (ProfileRow & { is_suspended: boolean; is_hidden: boolean; visibility: string })[]) {
    // Unlike loadFriendProfiles above, these are activity TARGETS ("Ada followed
    // X") and X may be a stranger to the viewer — and this helper has no viewer
    // to compare against. So an admin-hidden target is dropped outright rather
    // than per-viewer: fail closed, at the cost of a friend not seeing a hidden
    // friend named as a target here. Narrow surface, and the safe direction.
    if (r.is_suspended || r.is_hidden || !r.handle || r.visibility !== "public") continue;
    out.set(r.id, toProfile(r));
  }
  return out;
}
