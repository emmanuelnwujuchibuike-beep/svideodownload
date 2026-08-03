/**
 * Curated wallpaper set for the download page's "Wallpapers" section.
 *
 * 12 downloadable images. The bytes are served through our OWN /api/wallpaper
 * route (same-origin), so display needs no CSP exception and the download needs no
 * CORS — and the CDN caches each one after the first fetch. The source URLs below
 * are the only place to swap in your own artwork: replace `sourceFor` with your CDN
 * / R2 URLs and the grid, viewer and download all follow automatically.
 *
 * NOTE: labels are decorative (name + category + resolution) — deliberately NO
 * view/like/download counts, which would be fabricated engagement (owner's
 * standing "no fake stats" rule).
 */

export interface Wallpaper {
  id: string;
  name: string;
  category: string;
}

export const WALLPAPERS: Wallpaper[] = [
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

const BY_ID = new Map(WALLPAPERS.map((w) => [w.id, w]));

export function getWallpaper(id: string): Wallpaper | undefined {
  return BY_ID.get(id);
}

export type WallpaperSize = "thumb" | "full";

/** The upstream image URL for a wallpaper. Swap this for your own CDN/R2 URLs. */
export function sourceFor(id: string, size: WallpaperSize): string {
  const dims = size === "thumb" ? "600/900" : "1080/1920";
  // Deterministic per-id photo; `frenz-wp-<id>` keeps thumb + full the same image.
  return `https://picsum.photos/seed/frenz-wp-${id}/${dims}`;
}
