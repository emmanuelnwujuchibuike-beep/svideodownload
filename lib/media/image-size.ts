/**
 * Pixel dimensions read straight out of an image's header bytes.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * The wallpaper reference marks every design "4K · Ultra HD". The `wallpapers`
 * table has had `width`/`height` columns since 0105 and NOTHING has ever written
 * them, so every row is null — a resolution badge built on that would either
 * show nothing at all or be a decoration, and fabricated numbers are the one
 * thing this platform refuses to ship.
 *
 * So the dimensions get measured for real, at upload, from the bytes we are
 * already holding in memory.
 *
 * ── Why a header parser rather than an image library ──────────────────────────
 * `sharp` is a native binary that has to be built per platform and would be
 * dragged into the Vercel bundle for a task that reads at most 32 bytes of every
 * file. Every format this platform accepts writes its dimensions within the
 * first few hundred bytes; parsing them is a page of arithmetic with no
 * dependency, no decode, and no memory cost proportional to the image.
 *
 * Pure and total: it never throws and never allocates a copy — an unrecognised,
 * truncated or corrupt file returns `null`, and the caller stores nothing rather
 * than storing a guess.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** Reject nonsense early: a parse that lands outside this range mis-read. */
const MAX_DIMENSION = 100_000;

function ok(width: number, height: number): ImageSize | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { width, height };
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}

function u32be(b: Uint8Array, i: number): number {
  // `>>> 0` because a PNG dimension can set the high bit and JS would sign it.
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}

function ascii(b: Uint8Array, i: number, length: number): string {
  let s = "";
  for (let k = 0; k < length; k += 1) s += String.fromCharCode(b[i + k] ?? 0);
  return s;
}

/**
 * PNG — fixed layout, so there is nothing to search for: an 8-byte signature,
 * then the IHDR chunk whose first two fields are the dimensions.
 */
function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i += 1) if (b[i] !== SIG[i]) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return ok(u32be(b, 16), u32be(b, 20));
}

/**
 * JPEG — a marker stream, so the dimensions live wherever the encoder put them.
 * Walk the segment chain to the first Start-Of-Frame; SOF is the only marker
 * that carries the frame size, and every other segment declares its own length
 * so skipping them is exact rather than a scan for a byte pattern.
 */
function jpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    // Fill bytes (0xFF padding) are legal between segments.
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers carry no payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    // SOF0-3, SOF5-7, SOF9-11, SOF13-15. The excluded ones (C4/C8/CC) are
    // Huffman tables, JPEG extensions and arithmetic-coding tables — same
    // numeric neighbourhood, entirely different payload.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > b.length) return null;
      // [len:2][precision:1][height:2][width:2]
      return ok(u16be(b, i + 7), u16be(b, i + 5));
    }
    // Entropy-coded data follows the scan header and is not length-prefixed;
    // the frame size always precedes it, so there is nothing left to find.
    if (marker === 0xda) return null;
    i += 2 + length;
  }
  return null;
}

/**
 * WebP — three genuinely different bitstreams behind one RIFF container, each
 * storing its size in its own way. Guessing one and hoping is how a lossless
 * upload silently records a lossy frame's dimensions.
 */
function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 21) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);

  // The length each branch needs is different, so it is checked per branch: a
  // single `< 30` guard rejected every lossless WebP, whose header ends at 25.
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    // Canvas size as 24-bit little-endian, stored minus one.
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return ok(w, h);
  }

  if (chunk === "VP8L") {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    // 14 bits of (width - 1), then 14 bits of (height - 1), little-endian.
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }

  if (chunk === "VP8 ") {
    if (b.length < 30) return null;
    // 3-byte frame tag, the key-frame start code, then two 14-bit dimensions
    // (the top 2 bits of each 16 are a scale factor, not size).
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return ok((b[26]! | (b[27]! << 8)) & 0x3fff, (b[28]! | (b[29]! << 8)) & 0x3fff);
  }

  return null;
}

/**
 * AVIF — ISOBMFF. The size lives in an `ispe` box nested four levels deep
 * (meta ▸ iprp ▸ ipco ▸ ispe), and walking that tree properly means
 * implementing box parsing for boxes we otherwise have no use for.
 *
 * `ispe` has a fixed 12-byte body and appears in the metadata that precedes the
 * image data, so finding the first one by name is exact for a single-image AVIF
 * and costs one pass over a few hundred bytes. The bounds check on the result is
 * what stops a coincidental byte sequence being read as a dimension.
 */
function avif(b: Uint8Array): ImageSize | null {
  if (b.length < 32) return null;
  if (ascii(b, 4, 4) !== "ftyp") return null;
  const brand = ascii(b, 8, 4);
  if (brand !== "avif" && brand !== "avis" && brand !== "mif1" && brand !== "heic") return null;

  const limit = Math.min(b.length - 12, 4096);
  for (let i = 8; i < limit; i += 1) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
      // [name:4][version+flags:4][width:4][height:4]
      return ok(u32be(b, i + 8), u32be(b, i + 12));
    }
  }
  return null;
}

/**
 * Dimensions of a JPEG, PNG, WebP or AVIF — the four types the wallpaper
 * uploads accept. Anything else, or anything malformed, is `null`.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (!bytes || bytes.length < 16) return null;
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes) ?? avif(bytes);
}

/**
 * Convenience for the upload routes, which hold a `File`/`Blob`.
 *
 * Only the leading slice is read: every supported format writes its dimensions
 * near the front, and a 20 MB wallpaper should not be copied into a second
 * buffer to learn two numbers. JPEG is the one format where a fat EXIF thumbnail
 * can push the SOF marker back, which is what the 256 kB allows for.
 */
export async function imageSizeOf(blob: Blob): Promise<ImageSize | null> {
  try {
    const head = blob.slice(0, 256 * 1024);
    return imageSize(new Uint8Array(await head.arrayBuffer()));
  } catch {
    return null;
  }
}
