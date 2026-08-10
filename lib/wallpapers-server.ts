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
  width: number | null;
  height: number | null;
  downloads_count: number | null;
  /** Migration 0108 — absent until it is applied. */
  views_count?: number | null;
  views_boost?: number | null;
  likes_boost?: number | null;
  saves_boost?: number | null;
}

/*
  `width`, `height` and `downloads_count` are all 0105 columns, so they are safe
  in the base select — they exist wherever the table does. They were simply never
  read: dimensions were never even WRITTEN until the upload routes started
  measuring them (see lib/media/image-size.ts), which is why the resolution badge
  could not exist before now and why old rows need the backfill script.
*/
const BASE_COLUMNS =
  "id, title, category, image_url, thumb_url, status, likes_count, saves_count, comments_count, downloads_count, width, height, created_at";
/** Migration 0108: real views + the signed operator adjustments. */
const METRIC_COLUMNS = "views_count, views_boost, likes_boost, saves_boost";

/**
 * What a visitor sees for a metric: the REAL count plus the operator's signed
 * adjustment (0108), floored at zero. The two are kept apart in the database on
 * purpose — see the migration — so the platform never loses track of which part
 * was actually earned. The admin panel renders both.
 */
function shown(real: number | null | undefined, boost: number | null | undefined): number {
  return Math.max(0, (real ?? 0) + (boost ?? 0));
}

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
    likes: shown(row.likes_count, row.likes_boost),
    saves: shown(row.saves_count, row.saves_boost),
    comments: row.comments_count ?? 0,
    views: shown(row.views_count, row.views_boost),
    // Deliberately NOT boostable — "Popular" is ranked on this, and a ranking an
    // operator can move is a promotion, not a measurement.
    downloads: row.downloads_count ?? 0,
    // Null until measured. `resolutionBadge` shows nothing for a null, which is
    // the whole point: an unmeasured wallpaper never gets a flattering 4K chip.
    width: row.width ?? null,
    height: row.height ?? null,
    /*
      When this was uploaded — the default sort (owner, 2026-08-09: "make the
      wallpaper page to show wallpaper based on time uploaded").

      `created_at` was already being SELECTED and then thrown away here, so the
      gallery had no way to sort by it even though the data was in hand.
    */
    createdAt: row.created_at ?? null,
    builtIn: false,
  };
}

/**
 * Selects the metric columns when they exist and silently falls back when they
 * don't. Without this, a deploy where 0108 hasn't been applied would fail the
 * whole select and drop the library back to the built-in placeholders — the
 * operator's real wallpapers would appear to vanish.
 */
async function selectWallpapers(
  build: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Row[]> {
  try {
    const { data, error } = await build(`${BASE_COLUMNS}, ${METRIC_COLUMNS}`);
    if (!error) return (data ?? []) as Row[];
  } catch {
    /* 0108 not applied — fall back */
  }
  try {
    const { data, error } = await build(BASE_COLUMNS);
    if (error) return [];
    return (data ?? []) as Row[];
  } catch {
    return [];
  }
}

/**
 * The published library, newest-curated first. Falls back to the built-in set
 * while the real one is empty. When `viewerId` is given, each wallpaper also
 * carries whether THAT viewer has liked or saved it.
 */
export async function listWallpapers(viewerId?: string | null, limit = 120): Promise<Wallpaper[]> {
  const rows = await selectWallpapers((columns) =>
    createAdminClient()
      .from("wallpapers")
      .select(columns)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit),
  );

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
  const rows = await selectWallpapers((columns) =>
    createAdminClient()
      .from("wallpapers")
      .select(`${columns}, sort_order, bytes`)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return rows.map((row) => ({
    ...toWallpaper(row),
    status: row.status,
    sortOrder: (row as { sort_order?: number }).sort_order ?? 0,
    createdAt: row.created_at,
    // The admin panel needs the REAL counts and the adjustments apart, so an
    // operator can always see what was earned versus what they added.
    realLikes: row.likes_count ?? 0,
    realSaves: row.saves_count ?? 0,
    realViews: row.views_count ?? 0,
    likesBoost: row.likes_boost ?? 0,
    savesBoost: row.saves_boost ?? 0,
    viewsBoost: row.views_boost ?? 0,
  }));
}

/**
 * Bump the real download counter, and record the download where the ADMIN can
 * see it. Never gates the download itself.
 *
 * ── Why the second write exists (owner, 2026-08-10) ──────────────────────────
 * "Make admin see in live activity and download history in admin dashboard when
 * a user downloads a wallpaper from the wallpaper gallery."
 *
 * Wallpaper downloads were counted but never LOGGED. `wallpapers.downloads_count`
 * is a per-wallpaper tally, and the admin dashboard's live activity and download
 * history both read the `downloads` table — which the wallpaper route never
 * wrote to. So an operator watching activity saw video downloads appear in real
 * time and wallpaper downloads not at all, while the gallery's own counters
 * climbed. Two numbers that should agree, disagreeing, with no way to reconcile
 * them from either screen.
 *
 * The row is written in the same shape a media download uses, so it lands in the
 * existing activity feed, the existing history table and the existing totals
 * with no special-casing anywhere downstream. `format: "image"` and a
 * `wallpaper:` source url are what distinguish it when someone wants to.
 */
export async function recordWallpaperDownload(
  id: string,
  meta?: { userId?: string | null; name?: string | null },
): Promise<void> {
  if (getBuiltInWallpaper(id)) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("wallpapers").select("downloads_count").eq("id", id).maybeSingle();
    if (!data) return;
    await admin
      .from("wallpapers")
      .update({ downloads_count: ((data.downloads_count as number) ?? 0) + 1 })
      .eq("id", id);

    /*
      Best-effort and separately caught: a failure to LOG must never roll back
      the counter that did succeed, and neither may cost anyone their file.
    */
    try {
      await admin.from("downloads").insert({
        source_url: `wallpaper:${id}`,
        platform: "generic",
        title: meta?.name ?? "Wallpaper",
        format: "image",
        status: "completed",
        // Null for a signed-out visitor, which the activity feed already renders
        // as "Anonymous" — the same treatment a guest video download gets.
        user_id: meta?.userId ?? null,
      });
    } catch {
      /* activity logging is never worth failing a download over */
    }
  } catch {
    /* a missed count must never cost someone their download */
  }
}
