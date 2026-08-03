import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { getBuiltInWallpaper, type Wallpaper, type WallpaperComment } from "./wallpapers";

/**
 * Server reads/writes for the wallpaper library (migration 0105).
 *
 * Every read is defensive: before 0105 is applied the tables do not exist, and
 * the download page's Wallpapers section must degrade to the built-in set rather
 * than 500 the page.
 */

interface Row {
  id: string;
  title: string;
  category: string;
  image_url: string;
  thumb_url: string | null;
  status: string;
  likes_count: number | null;
  saves_count: number | null;
  comments_count: number | null;
  created_at: string;
}

const COLUMNS =
  "id, title, category, image_url, thumb_url, status, likes_count, saves_count, comments_count, created_at";

function toWallpaper(row: Row): Wallpaper {
  return {
    id: row.id,
    name: row.title,
    category: row.category,
    url: row.image_url,
    thumbUrl: row.thumb_url || row.image_url,
    // Routed through our own endpoint so the response carries a filename and
    // the browser saves rather than navigates.
    downloadUrl: `/api/wallpaper?id=${row.id}&dl=1`,
    likes: row.likes_count ?? 0,
    saves: row.saves_count ?? 0,
    comments: row.comments_count ?? 0,
    builtIn: false,
  };
}

/**
 * The published library, newest-curated first. Falls back to the built-in set
 * while the real one is empty. When `viewerId` is given, each wallpaper also
 * carries whether THAT viewer has liked or saved it.
 */
export async function listWallpapers(viewerId?: string | null, limit = 120): Promise<Wallpaper[]> {
  let rows: Row[] = [];
  try {
    const { data } = await createAdminClient()
      .from("wallpapers")
      .select(COLUMNS)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);
    rows = (data ?? []) as Row[];
  } catch {
    rows = [];
  }

  if (rows.length === 0) {
    const { builtInWallpapers } = await import("./wallpapers-builtin");
    return builtInWallpapers();
  }

  const wallpapers = rows.map(toWallpaper);
  if (!viewerId) return wallpapers;

  try {
    const admin = createAdminClient();
    const ids = wallpapers.map((w) => w.id);
    const [{ data: likes }, { data: saves }] = await Promise.all([
      admin.from("wallpaper_likes").select("wallpaper_id").eq("user_id", viewerId).in("wallpaper_id", ids),
      admin.from("wallpaper_saves").select("wallpaper_id").eq("user_id", viewerId).in("wallpaper_id", ids),
    ]);
    const liked = new Set((likes ?? []).map((r) => r.wallpaper_id as string));
    const saved = new Set((saves ?? []).map((r) => r.wallpaper_id as string));
    for (const w of wallpapers) {
      w.viewerLiked = liked.has(w.id);
      w.viewerSaved = saved.has(w.id);
    }
  } catch {
    /* engagement tables unavailable — the library still renders */
  }
  return wallpapers;
}

/** One wallpaper's source URL, for the /api/wallpaper proxy. */
export async function wallpaperImageUrl(id: string): Promise<{ url: string; name: string } | null> {
  const builtIn = getBuiltInWallpaper(id);
  if (builtIn) {
    const { sourceFor } = await import("./wallpapers");
    return { url: sourceFor(id, "full"), name: builtIn.name };
  }
  try {
    const { data } = await createAdminClient()
      .from("wallpapers")
      .select("title, image_url")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (!data) return null;
    return { url: data.image_url as string, name: data.title as string };
  } catch {
    return null;
  }
}

export async function listWallpaperComments(wallpaperId: string, limit = 50): Promise<WallpaperComment[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("wallpaper_comments")
      .select("id, body, created_at, user_id")
      .eq("wallpaper_id", wallpaperId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = data ?? [];
    if (rows.length === 0) return [];

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, handle, display_name, avatar_url")
      .in("id", rows.map((r) => r.user_id as string));
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    return rows.map((r) => {
      const p = byId.get(r.user_id as string);
      return {
        id: r.id as string,
        body: r.body as string,
        createdAt: r.created_at as string,
        authorHandle: (p?.handle as string | null) ?? null,
        authorName: (p?.display_name as string | null) ?? null,
        authorAvatar: (p?.avatar_url as string | null) ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** Admin view — every wallpaper, including hidden ones. */
export async function listAllWallpapers(limit = 300) {
  try {
    const { data } = await createAdminClient()
      .from("wallpapers")
      .select(`${COLUMNS}, sort_order, bytes, width, height`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      ...toWallpaper(row as Row),
      status: (row as Row).status,
      sortOrder: (row as { sort_order?: number }).sort_order ?? 0,
      createdAt: (row as Row).created_at,
    }));
  } catch {
    return [];
  }
}

/** Bump the real download counter. Never gates the download itself. */
export async function recordWallpaperDownload(id: string): Promise<void> {
  if (getBuiltInWallpaper(id)) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("wallpapers").select("downloads_count").eq("id", id).maybeSingle();
    if (!data) return;
    await admin
      .from("wallpapers")
      .update({ downloads_count: ((data.downloads_count as number) ?? 0) + 1 })
      .eq("id", id);
  } catch {
    /* a missed count must never cost someone their download */
  }
}
