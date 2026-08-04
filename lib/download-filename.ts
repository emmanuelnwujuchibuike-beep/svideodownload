/**
 * Building a safe filename for a downloaded file.
 *
 * ── The bug this exists to prevent ────────────────────────────────────────
 * The old one-liner was:
 *
 *     filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120)
 *
 * `slice` cuts from the END, which is exactly where the extension lives. A
 * tweet titled "🚨 BREAKING: Bayern Munich are monitoring Benjamin Sesko…"
 * produced `… replacement option in attack.jp` — no valid extension, so iOS
 * offered it as a generic "File" and it could not be saved to Photos. Short
 * titles were unaffected, which is why only SOME images failed.
 *
 * So the extension is split off FIRST, the base name is truncated, and the two
 * are rejoined. The extension is never part of the truncation budget.
 *
 * ── Why the extension is trusted from our own code, not the title ─────────
 * `extensionOf` only accepts a short, alphanumeric trailing segment. A title
 * that happens to contain a dot ("Ep. 4 — the finale") must not be mistaken for
 * an extension, and a caller appending ".jpg" must always win.
 *
 * Pure: no DOM, no I/O — so the rule is testable without a browser.
 */

/** Longest filename we will produce, extension included. */
const MAX_LENGTH = 120;

/**
 * The extension at the end of `name`, without the dot, or "" if there isn't a
 * plausible one. Deliberately strict: 1–5 characters, letters and digits only.
 * "photo.final" is not an extension; "clip.mp4" and "img.jpeg" are.
 */
export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Makes one path segment safe across Windows, macOS/iOS, Android and Linux.
 *
 * Beyond the obvious illegal characters this also folds runs of separators,
 * strips leading/trailing dots and spaces (a leading dot hides a file on Unix;
 * a trailing dot or space is silently dropped by Windows, producing a name that
 * doesn't round-trip), and refuses the reserved Windows device names.
 */
export function sanitizeBaseName(raw: string): string {
  const cleaned = raw
    // Anything that isn't a word char, dot, dash or space becomes a separator.
    // Emoji are surrogate PAIRS, so `+` is what stops one emoji becoming "__".
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s._-]+/, "")
    .replace(/[\s._-]+$/, "")
    .trim();

  // CON, PRN, AUX, NUL, COM1-9, LPT1-9 are device names on Windows — a file
  // called any of them cannot be created, with or without an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `${cleaned}_file`;

  return cleaned;
}

/**
 * A safe filename for `title`, always ending in `.extension` when one is given.
 *
 * @param title     Human title (a tweet, a video name) — may be long, may hold
 *                  emoji, punctuation or nothing at all.
 * @param extension Extension WITHOUT the dot ("jpg"). Optional.
 */
export function buildDownloadFilename(title: string, extension?: string): string {
  const ext = (extension ?? "").replace(/^\./, "").toLowerCase();
  const base = sanitizeBaseName(title) || "download";

  if (!ext) return base.slice(0, MAX_LENGTH) || "download";

  // The extension and its dot are reserved out of the budget FIRST — this is
  // the whole fix. `+ 1` is the dot.
  const room = Math.max(1, MAX_LENGTH - ext.length - 1);
  // Trim again after cutting: a truncation can leave a trailing space or dash,
  // which would produce "name .jpg" or "name-.jpg".
  const trimmed = base.slice(0, room).replace(/[\s._-]+$/, "") || "download";
  return `${trimmed}.${ext}`;
}

/**
 * Normalises a filename that may ALREADY carry an extension — the shape the
 * download manager produces (`${title}.${ext}`). Splits the extension off,
 * sanitises the rest, and rejoins without ever eating the extension.
 */
export function safeDownloadFilename(filename: string): string {
  const ext = extensionOf(filename);
  const base = ext ? filename.slice(0, -(ext.length + 1)) : filename;
  return buildDownloadFilename(base, ext);
}

/**
 * A MIME type derived from a filename's extension.
 *
 * Used as a LAST RESORT when a Blob arrives with no type of its own. It matters
 * on iOS specifically: the share sheet decides whether to offer "Save Image" or
 * "Save Video" from the File's `type`, and `application/octet-stream` gets the
 * generic document treatment — the same symptom as a missing extension.
 * Returns "application/octet-stream" only when the extension is unknown.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  wav: "audio/wav",
};

export function mimeForExtension(filename: string): string {
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? "application/octet-stream";
}
