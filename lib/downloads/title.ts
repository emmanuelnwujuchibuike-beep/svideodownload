/**
 * A post's caption as a title: SHORTENED, never a reason to refuse (owner, 2026-10-30 — "some doesn't download at
 * all … it says strings must contain at most 300 characters when it fails").
 *
 * The download request carried the post's full caption as `title` (used for nothing but the file's name), and the
 * request schema REFUSED any title over 300 characters — so every post with a long caption failed to download at all,
 * whatever its quality: measured on vt.tiktok.com/ZSg7RLNdB (445 characters) and /ZSg7Y2uk3 (718), both HTTP 400
 * "String must contain at most 300 character(s)". The same rule refused "Publish to everyone" (/api/reels) and the
 * worker's store-media step for those posts.
 *
 * Now the browser shortens it before it is sent (a 700-character caption no longer rides in every download URL) and
 * the server shortens whatever still arrives longer (lib/validation.ts `clampedString`). No zod here: the downloader
 * page imports this, and zod must stay out of it (see the note at the top of lib/validation.ts).
 */
export const TITLE_MAX_CHARS = 300;

/** Trimmed, and cut to `max` whole characters — an emoji (two UTF-16 units) is never split in half. */
export function clampTitle(value: string, max: number = TITLE_MAX_CHARS): string {
  const t = value.trim();
  if (t.length <= max) return t; // fast path: no code point can be cut when the UTF-16 length fits
  return Array.from(t).slice(0, max).join("").trimEnd();
}
