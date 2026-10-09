import { BACKDROP_QUALITY } from "@/components/wallpapers/backdrop-quality";
import { SITE_URL } from "@/lib/site";

/**
 * Warm the image optimizer for a newly published wallpaper — before any
 * visitor has to (2026-10-09, owner's landing speed test: LCP 4.3 s).
 *
 * The landing's LCP element is the wallpaper card, and its first frame is the
 * NEWEST published wallpaper — usually a member upload minutes old. The first
 * visitor to ask for each optimized variant paid a cold transform: Vercel
 * fetched the ~0.5 MB original from Supabase and re-encoded it before sending
 * a byte. Measured on production: 3.3–4.7 s to first byte cold, ~0.7 s warm.
 *
 * So the publish itself asks for exactly the variants the card requests on a
 * phone and on desktop (deviceSizes up to 1080 px, the card's quality, both
 * formats the config serves), after the response has gone. Best-effort: a
 * failure only means a visitor pays the transform, as before.
 */
export const WARM_WIDTHS = [640, 828, 1080] as const;
const FORMATS = ["image/avif", "image/webp"] as const;

export function warmUrls(src: string, base: string = SITE_URL): string[] {
  return WARM_WIDTHS.map((w) => `${base}/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${BACKDROP_QUALITY}`);
}

export async function warmWallpaperImage(src: string | null | undefined): Promise<void> {
  if (!src || !SITE_URL) return;
  await Promise.all(
    warmUrls(src).flatMap((url) =>
      FORMATS.map((accept) =>
        fetch(url, { headers: { accept }, signal: AbortSignal.timeout(20_000) })
          .then((r) => r.arrayBuffer())
          .catch(() => undefined),
      ),
    ),
  );
}
