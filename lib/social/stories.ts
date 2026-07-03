import { createAdminClient } from "@/lib/supabase/admin";

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
async function audienceForScope(
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

    const { data } = await db
      .from("stories")
      .select("id, user_id, media_url, media_kind, caption, created_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(200);
    let rows = (data as { id: string; user_id: string; media_url: string; media_kind: "image" | "video"; caption: string | null; created_at: string }[]) ?? [];
    if (audience) rows = rows.filter((r) => audience.has(r.user_id));
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
