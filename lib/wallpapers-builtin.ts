import { BUILT_IN_WALLPAPERS, type Wallpaper } from "./wallpapers";

/**
 * The built-in placeholder set, shaped like real wallpapers.
 *
 * Split into its own module so `wallpapers-server.ts` can `import()` it only on
 * the path where the real library is empty — once an operator has published
 * anything, this never loads.
 */
export function builtInWallpapers(): Wallpaper[] {
  return BUILT_IN_WALLPAPERS.map((w) => ({
    id: w.id,
    name: w.name,
    category: w.category,
    url: `/api/wallpaper?id=${w.id}&size=full`,
    thumbUrl: `/api/wallpaper?id=${w.id}&size=thumb`,
    downloadUrl: `/api/wallpaper?id=${w.id}&size=full&dl=1`,
    likes: 0,
    saves: 0,
    comments: 0,
    // A placeholder has no database row, so it has nothing real to count and
    // is never given an invented number.
    views: 0,
    downloads: 0,
    // Not a guess: `sourceFor(id, "full")` asks the upstream for exactly
    // 1080×1920, so this is the size of the bytes that will actually arrive.
    // It earns the built-ins an honest "Full HD" badge — and, correctly, never
    // a 4K one.
    width: 1080,
    height: 1920,
    builtIn: true,
  }));
}
