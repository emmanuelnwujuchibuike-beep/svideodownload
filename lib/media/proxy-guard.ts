/**
 * Guards for /api/media/download (Part 9, 2026-10-09 audit): the route that
 * streams one of our own storage objects back as an attachment. Pure, so the
 * rules are testable.
 */

/** Part 9 (2026-10-09): the largest object this route will stream. Bigger files are refused, never relayed. */
export const MEDIA_PROXY_MAX_BYTES = 200 * 1024 * 1024;

/**
 * The public wallpaper library, decided on the PARSED url: our Supabase host, the
 * public `wallpapers` bucket path, no query. (Part 9 audit: the old test was a regex
 * on the raw string, so `?x=/wallpapers/` on ANY object skipped sign-in.)
 */
export function isPublicWallpaperUrl(target: URL, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    return target.protocol === "https:" && target.host === new URL(supabaseUrl).host && target.pathname.startsWith("/storage/v1/object/public/wallpapers/") && target.search === "";
  } catch {
    return false;
  }
}

/** Only storage OBJECTS on the Supabase host - never its REST, auth or admin paths. */
export function isStorageObjectPath(target: URL, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return true; // R2-only deploys: the host check is the gate
  try {
    if (target.host !== new URL(supabaseUrl).host) return true; // R2 host: checked by allowedHosts
    return target.pathname.startsWith("/storage/v1/object/");
  } catch {
    return false;
  }
}

