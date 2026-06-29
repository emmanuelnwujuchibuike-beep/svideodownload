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
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  stories: StoryItem[];
}

/** Active (non-expired) stories grouped by author, most recent author first.
 *  Public profiles only; the viewer's own group is surfaced first when present. */
export async function getActiveStories(viewerId: string | null, limit = 20): Promise<StoryGroup[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("stories")
      .select("id, user_id, media_url, media_kind, caption, created_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data as { id: string; user_id: string; media_url: string; media_kind: "image" | "video"; caption: string | null; created_at: string }[]) ?? [];
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
