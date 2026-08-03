/**
 * The wallpaper library.
 *
 * Wallpapers are uploaded and curated by an admin (migration 0105 + the admin
 * dashboard's Wallpapers panel) and stored in the public `wallpapers` bucket.
 *
 * ── Why the curated fallback still exists ─────────────────────────────────────
 * Until an operator has uploaded anything — and on any deploy where 0105 hasn't
 * been applied yet — `listWallpapers()` returns the 12 built-in entries below so
 * the download page's Wallpapers section is never an empty hole. The moment one
 * real wallpaper is published, the built-ins stop being served. Built-in bytes
 * are proxied through /api/wallpaper; uploaded ones are served straight from the
 * bucket CDN.
 *
 * Labels are name + category + resolution only — deliberately NO fabricated
 * view/like/download counts. The counts on an uploaded wallpaper are real,
 * maintained by the triggers in 0105.
 */

export interface Wallpaper {
  id: string;
  name: string;
  category: string;
  /** Full-size image. */
  url: string;
  /** Grid thumbnail; falls back to `url`. */
  thumbUrl: string;
  /** Direct-download URL (adds a filename). */
  downloadUrl: string;
  likes: number;
  saves: number;
  comments: number;
  /** Real views plus the operator's adjustment (migration 0108), floored at 0. */
  views: number;
  /** True for the built-in placeholders — they have no database row, so they
   *  can't be liked, saved or commented on. */
  builtIn: boolean;
  viewerLiked?: boolean;
  viewerSaved?: boolean;
}

/** The built-in set, used only while the real library is empty. */
export const BUILT_IN_WALLPAPERS: { id: string; name: string; category: string }[] = [
  { id: "1", name: "Aurora", category: "Gradient" },
  { id: "2", name: "Nightfall", category: "Abstract" },
  { id: "3", name: "Ember", category: "Texture" },
  { id: "4", name: "Tidal", category: "Nature" },
  { id: "5", name: "Prism", category: "Gradient" },
  { id: "6", name: "Obsidian", category: "Dark" },
  { id: "7", name: "Bloom", category: "Nature" },
  { id: "8", name: "Neon Dusk", category: "Abstract" },
  { id: "9", name: "Marble", category: "Texture" },
  { id: "10", name: "Horizon", category: "Minimal" },
  { id: "11", name: "Cosmos", category: "Space" },
  { id: "12", name: "Frost", category: "Minimal" },
];

const BUILT_IN_BY_ID = new Map(BUILT_IN_WALLPAPERS.map((w) => [w.id, w]));

export type WallpaperSize = "thumb" | "full";

/** Upstream image URL for a BUILT-IN wallpaper (proxied by /api/wallpaper). */
export function sourceFor(id: string, size: WallpaperSize): string {
  const dims = size === "thumb" ? "600/900" : "1080/1920";
  // Deterministic per-id photo; `frenz-wp-<id>` keeps thumb + full the same image.
  return `https://picsum.photos/seed/frenz-wp-${id}/${dims}`;
}

export function getBuiltInWallpaper(id: string): { id: string; name: string; category: string } | undefined {
  return BUILT_IN_BY_ID.get(id);
}

export interface WallpaperComment {
  id: string;
  body: string;
  createdAt: string;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatar: string | null;
}
