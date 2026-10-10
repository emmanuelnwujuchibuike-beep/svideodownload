/**
 * Avatars at the size they are SHOWN, from Supabase's image CDN (owner,
 * 2026-10-10: "use supabase CDN and storage for the image and avatar … the
 * avatar image shouldn't even show blank on first load").
 *
 * An avatar is uploaded as a ~512 px JPEG (components/social/image-upload.tsx)
 * and a chat row draws it at 52 px. Every row used to fetch and DECODE the full
 * file. Through the renderer the same face is a ~3 KB WebP at 128 px (measured
 * 2026-10-10: 3,254 bytes), which decodes in the frame it arrives.
 *
 *   · sizes come in three buckets (128 / 192 / 384) so a face shown at 44 px
 *     and at 52 px is ONE cached file, not two
 *   · `resize=cover` — an avatar is square by construction; the crop is the
 *     uploaded one, so nothing new is cut
 *   · the `?v=` version stays on the URL: a new photo is a new URL, which is
 *     what lets the service worker keep these cache-first (public/sw/routes.js)
 *   · anything that is not a plain Supabase public object (an OAuth avatar, a
 *     blob: preview, an already-rendered URL) is returned exactly as given, as
 *     is a GIF (the renderer would freeze it on its first frame)
 *
 * Pure: the browser and the tests share it.
 */
const OBJECT = "/storage/v1/object/public/";
const RENDER = "/storage/v1/render/image/public/";

export const AVATAR_RENDER_BUCKETS = [128, 192, 384] as const;

/** The rendered edge for an avatar drawn at `displayPx` CSS px (2× for retina, rounded up to a bucket). */
export function avatarRenderPx(displayPx: number): number {
  const want = Math.ceil(Math.max(1, displayPx) * 2);
  return AVATAR_RENDER_BUCKETS.find((b) => b >= want) ?? AVATAR_RENDER_BUCKETS[AVATAR_RENDER_BUCKETS.length - 1]!;
}

export function avatarSrc(url: string | null | undefined, displayPx = 52): string {
  if (!url) return "";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!u.pathname.startsWith(OBJECT) || /\.gif$/i.test(u.pathname)) return url;
  const px = String(avatarRenderPx(displayPx));
  u.pathname = RENDER + u.pathname.slice(OBJECT.length);
  u.searchParams.set("width", px);
  u.searchParams.set("height", px);
  u.searchParams.set("resize", "cover");
  u.searchParams.set("quality", "70");
  return u.toString();
}
