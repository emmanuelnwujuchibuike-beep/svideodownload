import { WallpaperExploreSkeleton } from "@/features/wallpapers/wallpaper-explore-skeleton";

/**
 * /wallpapers instant shell.
 *
 * This is what makes the landing's Wallpaper button feel instant. The page itself is `force-dynamic`
 * (it reads the library and the session), so without a loading boundary a cold navigation would sit
 * on the previous page until the server responded. With one, Next paints this the moment the link is
 * tapped and streams the real page in behind it — and it is the STATIC part of the route, so
 * `<Link prefetch>` warms it cheaply.
 *
 * 2026-10-22: the skeleton is the redesigned page's (features/wallpapers/wallpaper-explore-skeleton.tsx),
 * shared with the page's own Suspense fallback — this file used to draw the retired layout.
 */
export default function WallpapersLoading() {
  return <WallpaperExploreSkeleton />;
}
