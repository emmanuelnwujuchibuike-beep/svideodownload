import { NO_TIES, rankStoryGroups, storyTier, storyVisibleTo, type StoryAuthorFacts, type StoryTier, type ViewerTies } from "@/lib/social/story-audience";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";
import { withTimeout } from "@/lib/utils";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StoryItem {
  id: string;
  mediaUrl: string;
  mediaKind: "image" | "video";
  caption: string | null;
  createdAt: string;
  /** The author's own switch (migration 0081): may other people reshare this
   *  story to their own story or a private chat? Defaults to true, including
   *  when 0081 isn't applied yet. */
  allowReshare: boolean;
  /**
   * First-frame poster for a VIDEO story (migration 0083). Load-bearing for
   * perceived speed, not decoration: without it the ring has to paint its 68px
   * circle with a <video preload="metadata">, which re-downloads MP4 data on
   * every mount and is the real cause of "the stories section loads for
   * seconds on every entrance". Null for images (they're their own cover) and
   * for stories posted before 0083 — those age out within 24h by themselves.
   */
  thumbnailUrl: string | null;
  /**
   * 🔴 Stories Part 3 (2026-10-26): has THIS viewer watched THIS story — their own
   * `story_views` row (0181), read in the same batch the ordering already uses. The
   * server is the authority for ring colour on every device; the client only adds
   * the views it has just had confirmed (lib/social/story-seen.ts). Optional so a
   * disk copy saved before Part 3 still parses (absent = not seen).
   */
  seen?: boolean;
  /** When the story ends (`stories.expires_at`, stamped by the database since 0285). */
  expiresAt?: string | null;
  /** The author's "Allow replies" switch (0288). Absent or unapplied = on, the column's own default. */
  allowReplies?: boolean;
}

/** Who a story reaches — the author's profile visibility (Part 2's rule). Sent for the viewer's OWN ring only. */
export type StoryAudience = "public" | "followers" | "private";

export interface StoryGroup {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  stories: StoryItem[];
  /** Only on the viewer's own ring: "Who can see this" in Story options. */
  audience?: StoryAudience;
}

/** Who a story feed is scoped to: everyone (default), just friends, or people you follow. */
export type StoryScope = "all" | "friends" | "following";

type Db = ReturnType<typeof createAdminClient>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STORIES PART 2 (2026-10-26) — who sees whose, and in what order
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   B1  WHO   one rule for every surface — lib/social/story-audience.ts — the
 *             SQL twin of story_view_access (0285, followers added in 0287), which
 *             guards views and reshares. This file only gathers the facts it needs.
 *   B2  WHICH the people the viewer is tied to (friends, follows, direct chats) are
 *             read BY AUTHOR, so their stories can never be crowded out by strangers
 *             posting more recently. The global "newest" read is now only DISCOVERY
 *             for Home, filling the space that is left with public stories.
 *   B3  ORDER yourself, friends, then follows and chats, then everyone else; within
 *             each, an unwatched story before a watched one (the viewer's own
 *             story_views rows), then the most recent.
 *
 * Every read is bounded and paged (PostgREST answers at most 1000 rows, with no
 * error — lib/supabase/paginate.ts), runs on the service role, and the result is
 * cached per VIEWER by /api/stories — never shared between people.
 */

/** Ties beyond this many people are not read in one feed — a backstop, far above any real friend/follow list here. */
const TIE_CAP = 5_000;
/** Authors per `.in()` query: keeps the request URL well under any proxy limit. */
const ID_CHUNK = 150;
/** Discovery for Home: the newest active stories platform-wide, before visibility. Only fills space after ties. */
const DISCOVERY_ROWS = 200;
/** Active stories read per chunk of tied authors (a member rarely has more than a handful live). */
const STORIES_PER_CHUNK = 1_000;

const chunks = <T,>(xs: readonly T[], n = ID_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/* ─────────────────────────── the viewer's ties ──────────────────────────── */

interface Ties {
  friends: Set<string>;
  following: Set<string>;
  chats: Set<string>;
}

async function viewerTiesUnbounded(db: Db, viewerId: string): Promise<Ties> {
  const [fr, fo, ch] = await Promise.all([
    paginatedSelect<{ user_low: string; user_high: string }>((a, b) => db.from("friendships").select("user_low, user_high").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).order("user_low").order("user_high").range(a, b), TIE_CAP),
    paginatedSelect<{ following_id: string }>((a, b) => db.from("follows").select("following_id").eq("follower_id", viewerId).order("following_id").range(a, b), TIE_CAP),
    paginatedSelect<{ user_low: string; user_high: string }>((a, b) => db.from("conversations").select("user_low, user_high").eq("type", "direct").or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`).order("user_low").order("user_high").range(a, b), TIE_CAP),
  ]);
  const other = (r: { user_low: string; user_high: string }) => (r.user_low === viewerId ? r.user_high : r.user_low);
  return {
    friends: new Set(fr.rows.map(other)),
    following: new Set(fo.rows.map((r) => r.following_id)),
    chats: new Set(ch.rows.map(other).filter(Boolean)),
  };
}

/** A failed or slow read is "no ties" — the viewer then sees only public stories, never more. */
async function viewerTies(db: Db, viewerId: string | null): Promise<Ties> {
  const none: Ties = { friends: new Set(), following: new Set(), chats: new Set() };
  if (!viewerId) return none;
  return withTimeout(viewerTiesUnbounded(db, viewerId).catch(() => none), 4000, none);
}

/**
 * Every user id blocked-with (either direction) OR status-restricted-with
 * (either direction, migration 0076 `user_restrictions` scope='status') the
 * viewer — used to hide Stories from/to blocked or status-restricted people.
 * Real gap fixed 2026-07-14: every other content surface (feed, comments,
 * discovery, profile RLS) already filters by `blocks`; Stories never did, so
 * a blocked user could still see and reply to your Stories and vice versa.
 *
 * 🔴 Stories Part 2: it fails CLOSED. `null` = the read failed or timed out, and
 * the caller then shows nobody's stories but the viewer's own. Before, a failure
 * meant "no exclusions" — a blocked member's story could show on a slow read.
 */
async function excludedStoryAuthorsUnbounded(db: Db, viewerId: string): Promise<Set<string> | null> {
  const excluded = new Set<string>();
  const [blockedByMe, blockedMe, restrictedByMe, restrictedMe] = await Promise.all([
    db.from("blocks").select("blocked_id").eq("blocker_id", viewerId),
    db.from("blocks").select("blocker_id").eq("blocked_id", viewerId),
    db.from("user_restrictions").select("restricted_id").eq("restrictor_id", viewerId).eq("scope", "status"),
    db.from("user_restrictions").select("restrictor_id").eq("restricted_id", viewerId).eq("scope", "status"),
  ]);
  if (blockedByMe.error || blockedMe.error || restrictedByMe.error || restrictedMe.error) return null;
  for (const r of (blockedByMe.data ?? []) as { blocked_id: string }[]) excluded.add(r.blocked_id);
  for (const r of (blockedMe.data ?? []) as { blocker_id: string }[]) excluded.add(r.blocker_id);
  for (const r of (restrictedByMe.data ?? []) as { restricted_id: string }[]) excluded.add(r.restricted_id);
  for (const r of (restrictedMe.data ?? []) as { restrictor_id: string }[]) excluded.add(r.restrictor_id);
  return excluded;
}

/**
 * Real bug found 2026-07-14: a genuine hang (not an error) in any of the four
 * queries above left the caller's `await` pending for ever — "stuck on loading"
 * on Home and an open thread. Time-boxed at the source, for every caller.
 */
async function excludedStoryAuthors(db: Db, viewerId: string | null): Promise<Set<string> | null> {
  if (!viewerId) return new Set<string>();
  return withTimeout(excludedStoryAuthorsUnbounded(db, viewerId).catch(() => null), 4000, null);
}

function tiesFor(authorId: string, ties: Ties, excluded: ReadonlySet<string>): ViewerTies {
  return { friend: ties.friends.has(authorId), follows: ties.following.has(authorId), chat: ties.chats.has(authorId), excluded: excluded.has(authorId) };
}

/* ─────────────────────────── the reads ──────────────────────────── */

type StoryRow = {
  id: string;
  user_id: string;
  media_url: string;
  media_kind: "image" | "video";
  caption: string | null;
  created_at: string;
  expires_at?: string | null;
  allow_reshare?: boolean | null;
  allow_replies?: boolean | null;
  thumbnail_url?: string | null;
};
type ProfileRow = { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_verified: boolean | null; visibility: string | null; is_suspended: boolean | null; is_hidden: boolean | null };

const STORY_COLS = "id, user_id, media_url, media_kind, caption, created_at, expires_at";

/** Whose active stories to read: some authors, one author, or the newest of everyone's (discovery). */
type Authors = { in: readonly string[] } | { one: string } | "everyone";

/**
 * Active stories, newest first. `allow_reshare` (0081), `thumbnail_url` (0083) and
 * `allow_replies` (0288) ride in an optional group: supabase-js fails the WHOLE
 * select on a missing column (42703), so an unapplied migration costs only those fields.
 */
async function activeStories(db: Db, authors: Authors, limit: number): Promise<StoryRow[]> {
  const now = new Date().toISOString();
  const run = (cols: string) =>
    paginatedSelect<StoryRow>((a, b) => {
      let q = db.from("stories").select(cols).gt("expires_at", now);
      if (authors !== "everyone") q = "one" in authors ? q.eq("user_id", authors.one) : q.in("user_id", [...authors.in]);
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: StoryRow[] | null; error: { message: string } | null }>;
    }, limit);
  const first = await run(`${STORY_COLS}, allow_reshare, thumbnail_url, allow_replies`);
  if (!/allow_reshare|thumbnail_url|allow_replies|42703|does not exist/.test(first.error?.message ?? "")) return first.rows;
  // 0288 not applied yet: keep the two older optional columns, lose only the reply switch
  const older = await run(`${STORY_COLS}, allow_reshare, thumbnail_url`);
  if (/allow_reshare|thumbnail_url|42703|does not exist/.test(older.error?.message ?? "")) return (await run(STORY_COLS)).rows;
  return older.rows;
}

async function profilesFor(db: Db, ids: readonly string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  const parts = await Promise.all(
    chunks(ids).map((c) => db.from("profiles").select("id, handle, display_name, avatar_url, is_verified, visibility, is_suspended, is_hidden").in("id", c)),
  );
  for (const p of parts) for (const r of (p.data ?? []) as ProfileRow[]) out.set(r.id, r);
  return out;
}

/** Which of these stories the viewer has already opened (their own story_views rows, 0181). */
async function watchedBy(db: Db, viewerId: string | null, storyIds: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  if (!viewerId || storyIds.length === 0) return seen;
  try {
    const parts = await Promise.all(chunks(storyIds, 200).map((c) => db.from("story_views").select("story_id").eq("viewer_id", viewerId).in("story_id", c)));
    for (const p of parts) for (const r of (p.data ?? []) as { story_id: string }[]) seen.add(r.story_id);
  } catch {
    /* unknown = unwatched: ordering only, never access */
  }
  return seen;
}

const facts = (p: ProfileRow): StoryAuthorFacts => ({ id: p.id, handle: p.handle, visibility: p.visibility, isSuspended: !!p.is_suspended, isHidden: !!p.is_hidden });

const toItem = (r: StoryRow, watched: ReadonlySet<string>): StoryItem => ({
  id: r.id,
  mediaUrl: r.media_url,
  mediaKind: r.media_kind,
  caption: r.caption,
  createdAt: r.created_at,
  // Absent column (0081 unapplied) === the column's own default.
  allowReshare: r.allow_reshare ?? true,
  thumbnailUrl: r.thumbnail_url ?? null,
  seen: watched.has(r.id),
  expiresAt: r.expires_at ?? null,
  allowReplies: r.allow_replies ?? true,
});

function groupOf(p: ProfileRow, stories: StoryItem[], viewerId: string | null = null): StoryGroup {
  const group: StoryGroup = {
    userId: p.id,
    handle: p.handle as string,
    displayName: p.display_name || `@${p.handle as string}`,
    avatarUrl: p.avatar_url ?? null,
    isVerified: !!p.is_verified,
    stories,
  };
  // your own ring says who it reaches (unknown values read as private, as story-audience.ts treats them)
  if (viewerId && p.id === viewerId) group.audience = p.visibility === "public" || p.visibility === "followers" ? p.visibility : "private";
  return group;
}

/**
 * Active stories grouped by author, for one viewer — Home and Messages (`all`),
 * and the Friends page's two tabs (`friends`, `following`). One ring per author,
 * their stories newest first, the viewer's own ring first.
 *
 *   all        everyone the viewer is tied to, then public discovery to fill
 *   friends    the viewer's friends (and the viewer)
 *   following  the people the viewer follows (and the viewer)
 *
 * Every author passes `storyVisibleTo` (story-audience.ts) before anything about
 * them leaves this function. A failure reads as fewer rings, never as more.
 */
export async function getActiveStories(viewerId: string | null, limit = 50, scope: StoryScope = "all"): Promise<StoryGroup[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const [ties, excluded] = await Promise.all([viewerTies(db, viewerId), excludedStoryAuthors(db, viewerId)]);

    // 🔴 Fail closed on the block list: only the viewer's own stories (Stories Part 2).
    const blocksUnknown = excluded === null;
    const exclude = excluded ?? new Set<string>();

    const tied = new Set<string>(
      blocksUnknown ? [] : scope === "friends" ? ties.friends : scope === "following" ? ties.following : [...ties.friends, ...ties.following, ...ties.chats],
    );
    if (viewerId) tied.add(viewerId);
    for (const id of exclude) tied.delete(id);

    // B2: the tied authors' stories, read by author — never crowded out by anyone else's
    const tiedIds = [...tied];
    const tiedRows = (await Promise.all(chunks(tiedIds).map((c) => activeStories(db, { in: c }, STORIES_PER_CHUNK)))).flat();
    // Home only: public discovery fills the space that is left (signed out, this is all there is)
    const discovery = scope === "all" && !blocksUnknown ? await activeStories(db, "everyone", DISCOVERY_ROWS) : [];

    const byId = new Map<string, StoryRow>();
    for (const r of [...tiedRows, ...discovery]) if (!exclude.has(r.user_id)) byId.set(r.id, r);
    const rows = [...byId.values()];
    if (rows.length === 0) return [];

    const authors = [...new Set(rows.map((r) => r.user_id))];
    const [profiles, watched] = await Promise.all([profilesFor(db, authors), watchedBy(db, viewerId, rows.map((r) => r.id))]);

    const grouped = new Map<string, { group: StoryGroup; tier: StoryTier; unwatched: boolean; newestAt: string }>();
    for (const r of rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))) {
      const p = profiles.get(r.user_id);
      if (!p) continue;
      const t = viewerId ? tiesFor(r.user_id, ties, exclude) : NO_TIES;
      if (!storyVisibleTo(facts(p), viewerId, t)) continue;
      let g = grouped.get(r.user_id);
      if (!g) {
        g = { group: groupOf(p, [], viewerId), tier: storyTier(r.user_id, viewerId, t), unwatched: false, newestAt: r.created_at };
        grouped.set(r.user_id, g);
      }
      g.group.stories.push(toItem(r, watched));
      if (!watched.has(r.id)) g.unwatched = true;
    }

    // B3: you, friends, follows/chats, everyone else — unwatched before watched — most recent first
    return rankStoryGroups([...grouped.values()])
      .slice(0, Math.max(1, limit))
      .map((g) => g.group);
  } catch {
    return [];
  }
}

/**
 * A single person's active stories, for the "N stories" strip at the top of a
 * DIRECT message thread. Since Stories Part 2 it answers by the SAME rule as every
 * other surface (story-audience.ts) — before, it skipped the profile-visibility
 * check entirely, which happened to match the chat rule only because the two
 * people are, by definition, in a direct chat.
 */
export async function getActiveStoryForUser(userId: string, viewerId?: string | null): Promise<StoryGroup | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const viewer = viewerId ?? null;
    const excluded = await excludedStoryAuthors(db, viewer);
    if (excluded === null || excluded.has(userId)) return null; // 🔴 fails closed

    const [rows, profiles, ties] = await Promise.all([
      activeStories(db, { one: userId }, 50),
      profilesFor(db, [userId]),
      viewer && viewer !== userId ? pairTies(db, viewer, userId) : Promise.resolve(NO_TIES),
    ]);
    const p = profiles.get(userId);
    if (!p || rows.length === 0) return null;
    if (!storyVisibleTo(facts(p), viewer, { ...ties, excluded: false })) return null;
    // Part 3: the viewer's own views of these stories, one batched read — only once they may see them
    const watched = await watchedBy(db, viewer, rows.map((r) => r.id));
    return groupOf(p, rows.map((r) => toItem(r, watched)), viewer);
  } catch {
    return null;
  }
}

/** The viewer's ties to ONE author — three point reads instead of their whole lists. */
async function pairTies(db: Db, viewerId: string, authorId: string): Promise<ViewerTies> {
  const [lo, hi] = viewerId < authorId ? [viewerId, authorId] : [authorId, viewerId];
  // both tables keep a pair as (lower id, higher id) — lib/social/friends.ts and messages.ts `pair`
  const read = Promise.all([
    db.from("friendships").select("user_low").eq("user_low", lo).eq("user_high", hi).limit(1),
    db.from("follows").select("follower_id").eq("follower_id", viewerId).eq("following_id", authorId).limit(1),
    db.from("conversations").select("id").eq("type", "direct").eq("user_low", lo).eq("user_high", hi).limit(1),
  ]).then(([f, fo, c]) => ({ friend: (f.data ?? []).length > 0, follows: (fo.data ?? []).length > 0, chat: (c.data ?? []).length > 0, excluded: false }));
  return withTimeout(read.catch(() => NO_TIES), 4000, NO_TIES);
}
