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
  /** Real completed downloads. Never adjustable — it ranks "Popular". */
  downloads: number;
  /** Measured pixel dimensions, or null when they were never recorded. */
  width: number | null;
  height: number | null;
  /**
   * Upload time (ISO), or null for the built-in placeholders — they ship with
   * the code and have no upload event, so "Newest" cannot rank them and must
   * not pretend to. Sorting puts them last rather than inventing a date.
   */
  createdAt?: string | null;
  /** True for the built-in placeholders — they have no database row, so they
   *  can't be liked, saved or commented on. */
  builtIn: boolean;
  viewerLiked?: boolean;
  viewerSaved?: boolean;
  /**
   * Who shared this, for MEMBER uploads only (owner, 2026-08-23: "make users
   * uploaded wallpaper to show the user's username instead of community").
   *
   * Null on admin-curated rows and on the built-ins — those are the library
   * speaking, not a person, and attributing them to an operator's handle would
   * be a claim nobody made. `handle` is null for a member who has never set
   * one; `wallpaperCredit` falls back to the category in that case rather than
   * rendering an empty byline.
   */
  uploader?: { handle: string | null; displayName: string | null } | null;
}

/**
 * The caption line under a wallpaper: the sharer's @handle where a real person
 * shared it, the category otherwise.
 *
 * One function rather than the same ternary in the grid, the download-page
 * preview and the reels viewer — those three drifted apart once already over
 * the resolution badge, and a byline that says "@ada" in one place and
 * "Community" in another for the same picture is worse than either alone.
 */
export function wallpaperCredit(w: Wallpaper): string {
  const handle = w.uploader?.handle?.trim();
  if (handle) return `@${handle}`;
  const name = w.uploader?.displayName?.trim();
  if (name) return name;
  return w.category;
}

/**
 * The resolution badge — "4K · Ultra HD" and friends.
 *
 * ── Measured, never assumed ───────────────────────────────────────────────────
 * The reference design (public/mainwallpaperpaage.jpg, public/reels
 * wallpaper.jpg) puts a 4K chip on every card. Stamping one on unconditionally
 * would be the cheapest thing to build and a lie on any wallpaper that isn't —
 * so the badge is derived from the real `width`/`height` on the row, and a
 * wallpaper whose size was never recorded shows NO badge rather than a flattering
 * one. That is why `imageSizeOf` runs on upload and why there is a backfill
 * script for the rows that predate it.
 *
 * ── Why the LONG edge decides ─────────────────────────────────────────────────
 * A phone wallpaper is portrait: 2160×3840 is the same 4K panel as a landscape
 * 3840×2160, just rotated. Testing width alone would call the portrait one "HD"
 * and mislabel the entire library, which is almost all portrait.
 *
 * Thresholds are the display standards themselves — 3840 (UHD), 2560 (QHD),
 * 1920 (FHD) — so the label means what a buyer of a screen thinks it means.
 * Below Full HD there is no badge: "SD" on a wallpaper is a warning, not
 * information, and the picture is right there to be judged.
 */
export interface ResolutionBadge {
  /** Compact form for a grid tile: "4K". */
  short: string;
  /** Spelled out for the viewer: "Ultra HD". */
  long: string;
}

export function resolutionBadge(
  width: number | null | undefined,
  height: number | null | undefined,
): ResolutionBadge | null {
  if (!width || !height || width < 1 || height < 1) return null;
  const longEdge = Math.max(width, height);
  if (longEdge >= 3840) return { short: "4K", long: "Ultra HD" };
  if (longEdge >= 2560) return { short: "2K", long: "Quad HD" };
  if (longEdge >= 1920) return { short: "HD", long: "Full HD" };
  return null;
}

/**
 * Alt text for a wallpaper image.
 *
 * ── Why this is a function and not a literal at the call site ─────────────────
 * The gallery images shipped as `alt="" aria-hidden`, which is correct markup
 * for decoration and wrong for the content of an image gallery: the one page on
 * this site whose entire purpose is publishing pictures published none of them
 * to Google Images, and a screen-reader user got a grid of unnamed buttons.
 *
 * The name and the category are the only things we truthfully know about the
 * picture, so that is what the text says. It is deliberately NOT "beautiful
 * stunning 4K HD free wallpaper background download" — keyword-stuffed alt text
 * is a spam signal to a crawler, and it is read aloud, in full, to a person.
 *
 * It lives here rather than in lib/seo so the client gallery can import it
 * without dragging four hundred words of page copy into its bundle.
 */
export function wallpaperAlt(w: Pick<Wallpaper, "name" | "category">): string {
  const category = w.category?.trim();
  return category ? `${w.name} — ${category.toLowerCase()} wallpaper` : `${w.name} wallpaper`;
}

/**
 * What SHAPE of screen a wallpaper is for — the reference's "Types" filter.
 *
 * Orientation is the only property of a wallpaper that a person filters on and
 * that we can state as fact from the file itself. A tall image on a monitor and
 * a wide image on a phone are both wrong in the same obvious way, so this is a
 * genuinely useful cut, and it needs no taxonomy anyone has to maintain.
 *
 * The square band is deliberately wide (0.9–1.1): a 1080×1080 and a 1200×1150
 * are the same thing to anybody choosing one, and a hairline boundary would sort
 * near-identical images into different filters.
 */
export type WallpaperType = "phone" | "desktop" | "square";

export const WALLPAPER_TYPES: { id: WallpaperType; label: string }[] = [
  { id: "phone", label: "Phone" },
  { id: "desktop", label: "Desktop" },
  { id: "square", label: "Square" },
];

export function wallpaperType(
  width: number | null | undefined,
  height: number | null | undefined,
): WallpaperType | null {
  if (!width || !height || width < 1 || height < 1) return null;
  const ratio = width / height;
  if (ratio >= 0.9 && ratio <= 1.1) return "square";
  return ratio < 0.9 ? "phone" : "desktop";
}

/**
 * "Popular" — ranked on what people DID, not on what we would like to promote.
 *
 * Saves and downloads outweigh likes because they cost something: a like is a
 * tap in passing, a download is someone deciding they want to look at this every
 * time they unlock their phone. Views are the weakest signal and are weighted
 * accordingly — they mostly measure how early a wallpaper sits in the scroll,
 * which is what this ordering is trying not to reward.
 *
 * Every input is a real counter maintained by the 0105 triggers. `views` carries
 * the operator's 0108 adjustment, which is why it is worth the least here: it is
 * the one number an operator can move.
 */
export function popularity(w: Pick<Wallpaper, "likes" | "saves" | "comments" | "views" | "downloads">): number {
  return w.downloads * 5 + w.saves * 4 + w.comments * 3 + w.likes * 2 + Math.min(w.views, 10_000) * 0.05;
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
