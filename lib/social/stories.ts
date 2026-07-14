import { createAdminClient } from "@/lib/supabase/admin";
import { withTimeout } from "@/lib/utils";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface StoryItem {
  id: string;
  mediaUrl: string;
  mediaKind: "image" | "video";
  caption: string | null;
  createdAt: string;
}

export interface StoryGroup {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  stories: StoryItem[];
}

/** Who a story feed is scoped to: everyone (default), just friends, or people you follow. */
export type StoryScope = "all" | "friends" | "following";

/**
 * The set of author ids a scoped feed is allowed to show (plus the viewer's own,
 * so your story always leads). Returns null for "all" (no restriction). Degrades
 * gracefully — if the friends/follows tables error, the scope simply resolves empty.
 */
async function audienceForScopeUnbounded(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string,
  scope: Exclude<StoryScope, "all">,
): Promise<Set<string>> {
  const ids = new Set<string>([viewerId]);
  try {
    if (scope === "following") {
      const { data } = await db.from("follows").select("following_id").eq("follower_id", viewerId);
      for (const f of ((data ?? []) as { following_id: string }[])) ids.add(f.following_id);
    } else {
      const { data } = await db
        .from("friendships")
        .select("user_low, user_high")
        .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`);
      for (const r of ((data ?? []) as { user_low: string; user_high: string }[])) {
        ids.add(r.user_low === viewerId ? r.user_high : r.user_low);
      }
    }
  } catch {
    /* table missing / error — leave scope as just the viewer */
  }
  return ids;
}

/** Same real hang risk as `excludedStoryAuthors` below (pre-existing, not
 *  new today) — closed the same way, at the source, while already here. */
async function audienceForScope(
  db: ReturnType<typeof createAdminClient>,
  viewerId: string,
  scope: Exclude<StoryScope, "all">,
): Promise<Set<string>> {
  return withTimeout(audienceForScopeUnbounded(db, viewerId, scope), 4000, new Set<string>([viewerId]));
}

/**
 * Every user id blocked-with (either direction) OR status-restricted-with
 * (either direction, migration 0076 `user_restrictions` scope='status') the
 * viewer — used to hide Stories from/to blocked or status-restricted people.
 * Real gap fixed 2026-07-14: every other content surface (feed, comments,
 * discovery, profile RLS) already filters by `blocks`; Stories never did, so
 * a blocked user could still see and reply to your Stories and vice versa.
 */
async function excludedStoryAuthorsUnbounded(db: ReturnType<typeof createAdminClient>, viewerId: string): Promise<Set<string>> {
  const excluded = new Set<string>();
  try {
    const [{ data: blockedByMe }, { data: blockedMe }, { data: restrictedByMe }, { data: restrictedMe }] = await Promise.all([
      db.from("blocks").select("blocked_id").eq("blocker_id", viewerId),
      db.from("blocks").select("blocker_id").eq("blocked_id", viewerId),
      db.from("user_restrictions").select("restricted_id").eq("restrictor_id", viewerId).eq("scope", "status"),
      db.from("user_restrictions").select("restrictor_id").eq("restricted_id", viewerId).eq("scope", "status"),
    ]);
    for (const r of (blockedByMe ?? []) as { blocked_id: string }[]) excluded.add(r.blocked_id);
    for (const r of (blockedMe ?? []) as { blocker_id: string }[]) excluded.add(r.blocker_id);
    for (const r of (restrictedByMe ?? []) as { restricted_id: string }[]) excluded.add(r.restricted_id);
    for (const r of (restrictedMe ?? []) as { restrictor_id: string }[]) excluded.add(r.restrictor_id);
  } catch {
    /* table missing / error — no exclusions, same fail-open posture as audienceForScope */
  }
  return excluded;
}

/**
 * Real bug found 2026-07-14, same day this was added: neither this function
 * nor its callers (`getActiveStories` on Home's stories rail — every logged-
 * in user's most common landing page — and `getActiveStoryForUser` on an
 * open chat thread) were ever time-boxed, despite `getActiveStories`'s own
 * doc comment already claiming a failed fetch "just means no strip." A
 * genuine hang (not just an error) in ANY of the 4 queries above — a network
 * stall, a slow connection — doesn't throw, so the try/catch above can't
 * help; it just leaves the caller's `await` pending forever, which read live
 * as "stuck on loading" on both Home and an open thread. `withTimeout` here,
 * at the source, protects every current AND future caller at once instead of
 * needing the same fix repeated at every call site.
 */
async function excludedStoryAuthors(db: ReturnType<typeof createAdminClient>, viewerId: string): Promise<Set<string>> {
  return withTimeout(excludedStoryAuthorsUnbounded(db, viewerId), 4000, new Set<string>());
}

/** Active (non-expired) stories grouped by author, most recent author first.
 *  Public profiles only; the viewer's own group is surfaced first when present.
 *  `scope` narrows to just friends or people you follow (signed-in viewers). */
export async function getActiveStories(
  viewerId: string | null,
  limit = 20,
  scope: StoryScope = "all",
): Promise<StoryGroup[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();

    // Resolve the allowed author set for scoped feeds up front.
    const audience = viewerId && scope !== "all" ? await audienceForScope(db, viewerId, scope) : null;
    const excluded = viewerId ? await excludedStoryAuthors(db, viewerId) : new Set<string>();

    const { data } = await db
      .from("stories")
      .select("id, user_id, media_url, media_kind, caption, created_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(200);
    let rows = (data as { id: string; user_id: string; media_url: string; media_kind: "image" | "video"; caption: string | null; created_at: string }[]) ?? [];
    if (audience) rows = rows.filter((r) => audience.has(r.user_id));
    if (excluded.size > 0) rows = rows.filter((r) => !excluded.has(r.user_id));
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: profs } = await db
      .from("profiles")
      .select("id, handle, display_name, avatar_url, is_verified, visibility, is_suspended")
      .in("id", userIds);
    const profById = new Map<string, Record<string, unknown>>();
    for (const p of (profs ?? []) as Record<string, unknown>[]) profById.set(p.id as string, p);

    const groups = new Map<string, StoryGroup>();
    for (const r of rows) {
      const p = profById.get(r.user_id);
      if (!p || !p.handle || p.is_suspended) continue;
      if (p.visibility !== "public" && r.user_id !== viewerId) continue;
      let g = groups.get(r.user_id);
      if (!g) {
        g = {
          userId: r.user_id,
          handle: p.handle as string,
          displayName: (p.display_name as string) || `@${p.handle as string}`,
          avatarUrl: (p.avatar_url as string) ?? null,
          isVerified: (p.is_verified as boolean) ?? false,
          stories: [],
        };
        groups.set(r.user_id, g);
      }
      g.stories.push({ id: r.id, mediaUrl: r.media_url, mediaKind: r.media_kind, caption: r.caption, createdAt: r.created_at });
    }

    const list = [...groups.entries()];
    // Viewer's own stories first, then by recency.
    list.sort((a, b) => (a[0] === viewerId ? -1 : b[0] === viewerId ? 1 : 0));
    return list.map(([, g]) => g).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * A single person's active stories, for the "N stories" strip embedded at the
 * top of a DIRECT message thread (owner mockup) — deliberately NOT
 * `getActiveStories()` with a narrow scope. That function is documented
 * "public profiles only": it hides a story from anyone whose profile
 * visibility isn't literally `'public'`, which is the right call for a
 * discovery-style feed (Home's stories reel) but silently broke the mockup's
 * in-thread strip for the (likely majority of) accounts that keep their
 * profile non-public — the two people are ALREADY in a direct conversation
 * together at this point, a strictly more intimate context than "anyone
 * browsing the app," so gating on general profile visibility here was wrong.
 * Confirmed by reading `getActiveStories`'s own doc comment, not assumed.
 *
 * `viewerId` (added 2026-07-14 alongside the blocking pass): when given,
 * hides the strip entirely if either party has blocked or status-restricted
 * the other — the same gap `getActiveStories` had, closed there via
 * `excludedStoryAuthors`. Optional (not `null`-defaulted) because a couple of
 * call sites don't yet have a viewer in scope; those keep today's behavior.
 */
export async function getActiveStoryForUser(userId: string, viewerId?: string | null): Promise<StoryGroup | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    if (viewerId && viewerId !== userId) {
      const excluded = await excludedStoryAuthors(db, viewerId);
      if (excluded.has(userId)) return null;
    }
    const { data } = await db
      .from("stories")
      .select("id, user_id, media_url, media_kind, caption, created_at")
      .eq("user_id", userId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data as { id: string; user_id: string; media_url: string; media_kind: "image" | "video"; caption: string | null; created_at: string }[]) ?? [];
    if (rows.length === 0) return null;

    const { data: prof } = await db
      .from("profiles")
      .select("handle, display_name, avatar_url, is_verified, is_suspended")
      .eq("id", userId)
      .maybeSingle();
    if (!prof || !prof.handle || prof.is_suspended) return null;

    return {
      userId,
      handle: prof.handle as string,
      displayName: (prof.display_name as string) || `@${prof.handle as string}`,
      avatarUrl: (prof.avatar_url as string) ?? null,
      isVerified: (prof.is_verified as boolean) ?? false,
      stories: rows.map((r) => ({ id: r.id, mediaUrl: r.media_url, mediaKind: r.media_kind, caption: r.caption, createdAt: r.created_at })),
    };
  } catch {
    return null;
  }
}
