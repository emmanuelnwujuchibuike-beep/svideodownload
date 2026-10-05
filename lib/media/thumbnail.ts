import "server-only";

/**
 * A resized WebP copy of an uploaded wallpaper, for grid/card display.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * `wallpapers.thumb_url` has existed since 0105 and nothing has ever written it
 * (see `lib/wallpapers-server.ts`'s `toWallpaper`), so every grid tile, deck
 * card and reels-viewer thumbnail falls back to the full-resolution original —
 * a card rendered at ~150px wide downloading the same multi-megapixel file a
 * full-screen open does. This generates the real small copy at upload time so
 * that stops being true for anything uploaded from here on.
 *
 * ── Why sharp, dynamically imported and never fatal ───────────────────────────
 * `lib/media/image-size.ts` deliberately avoids `sharp` for reading dimensions
 * because that task only needs 32 header bytes — pulling in a native binary for
 * that would be pure waste. This task is different: it genuinely needs to
 * decode and resize the image, which nothing but a real image library can do.
 * `sharp` is already what Next's own image optimizer relies on in this exact
 * Vercel/Node runtime, so it isn't a new kind of risk to the deploy — but it
 * also isn't a dependency THIS route controls the resolution of, so the import
 * and the whole resize are wrapped in try/catch. Any failure (binary missing
 * for a platform, a corrupt upload, an unsupported codec) degrades to "no
 * thumbnail" — the caller's existing `thumb_url || image_url` fallback — never
 * a failed upload.
 */

export interface Thumbnail {
  buffer: Buffer;
  contentType: "image/webp";
  ext: "webp";
}

/** Long edge for a grid/deck thumbnail — comfortably sharp on a 2x phone
 *  card (~180px wide) without shipping desktop-wallpaper pixel counts. */
const THUMB_MAX_EDGE = 640;
const THUMB_QUALITY = 68;

export interface SizedThumbnail extends Thumbnail {
  width: number;
  height: number;
}

/**
 * The same resize at a caller's size — the AI showcase makes a ~720 px and a
 * ~1280 px copy of one upload (app/api/admin/ai/showcase/route.ts). `maxWidth`
 * bounds the width only: a card is width-constrained, and a tall image must
 * not be shrunk to fit a square. Same never-fatal contract: `null` on failure.
 */
export async function makeSizedWebp(
  bytes: Uint8Array,
  { maxWidth, quality }: { maxWidth: number; quality: number },
): Promise<SizedThumbnail | null> {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const { data, info } = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, contentType: "image/webp", ext: "webp", width: info.width, height: info.height };
  } catch {
    return null;
  }
}

export async function makeThumbnail(bytes: Uint8Array): Promise<Thumbnail | null> {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const buffer = await sharp(Buffer.from(bytes))
      .rotate() // apply EXIF orientation before measuring/cropping
      .resize({
        width: THUMB_MAX_EDGE,
        height: THUMB_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    return { buffer, contentType: "image/webp", ext: "webp" };
  } catch {
    return null;
  }
}
