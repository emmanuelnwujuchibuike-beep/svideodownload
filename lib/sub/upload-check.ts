/**
 * What a creator actually uploaded, checked by the server before an exclusive post is
 * published (Frenz Exclusive Part 2, 2026-10-16).
 *
 * The browser PUTs straight into the private bucket with a presigned link, so the
 * extension and Content-Type it claims are the browser's word. This reads the file's own
 * first bytes ("magic numbers") and its real size:
 *
 *  · an "image" must start like a JPEG, PNG, GIF, WebP, AVIF or HEIC file;
 *  · a "video" must start like an MP4/MOV (ISO-BMFF `ftyp`) or WebM (EBML);
 *  · nothing over the size cap.
 *
 * It stops HTML, SVG (script-capable), archives and executables wearing a .jpg name. It is
 * NOT content moderation: no classifier looks at the pixels (no scanning service exists in
 * this stack; see docs/SUB_MONETIZATION.md "Upload scanning"). Pure, so it is unit-tested.
 */

export const SUB_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const SUB_MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((ch, i) => b[at + i] === ch.charCodeAt(0));

export type SniffedKind = "image" | "video" | null;

export function sniffMedia(b: Uint8Array): SniffedKind {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image"; // JPEG
  if (b[0] === 0x89 && ascii(b, 1, "PNG")) return "image";
  if (ascii(b, 0, "GIF8")) return "image";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video"; // WebM / Matroska
  if (ascii(b, 4, "ftyp")) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (/^(avif|avis|heic|heix|mif1|msf1|hevc)$/.test(brand)) return "image";
    return "video"; // isom, mp41, mp42, qt, M4V, 3gp…
  }
  // older QuickTime files open with another top-level atom instead of ftyp
  if (["moov", "wide", "mdat", "free", "skip"].some((a) => ascii(b, 4, a))) return "video";
  return null;
}

export function checkUpload(kind: "image" | "video", head: { prefix: Uint8Array; size: number } | null): { ok: true } | { ok: false; error: string } {
  if (!head) return { ok: false, error: "One of the files didn't finish uploading. Try again." };
  if (sniffMedia(head.prefix) !== kind) return { ok: false, error: "One of the files isn't a photo or video we can post." };
  const cap = kind === "image" ? SUB_MAX_IMAGE_BYTES : SUB_MAX_VIDEO_BYTES;
  if (!Number.isFinite(head.size) || head.size <= 0 || head.size > cap) return { ok: false, error: kind === "image" ? "Photos can be up to 50 MB." : "Videos can be up to 1 GB." };
  return { ok: true };
}
