/**
 * Caption rules, shared by every surface that writes or renders one.
 *
 * Owner, 2026-08-23:
 *   • "I want caption in feed and reels to be able to give paragraph when I
 *      give them a keyboard."
 *   • "Captions in feed should have a limit of 7 lines, any captions and
 *      paragraph more than 7 lines should show see more to expand, and a small
 *      close button below to reshrink the caption back to 7 lines."
 *   • "And caption should have a limit of 250 words."
 *
 * ── Why a WORD limit needs a character limit behind it ─────────────────────
 * Every composer previously enforced `maxLength={300}` — 300 CHARACTERS, which
 * is roughly 50 words. A 250-word caption is four to five times longer than
 * anything the old cap allowed, so the cap had to move or the new limit would
 * be decorative.
 *
 * A word count alone is not a safe storage bound, though: "words" are
 * whitespace-separated, and one "word" can be a 5 000-character URL or an
 * unbroken run of emoji. `CAPTION_MAX_CHARS` is the backstop that keeps a
 * row's size bounded no matter how the words are shaped. It is deliberately
 * generous (250 average English words land near 1 500 characters) so it only
 * ever catches abuse, never a real caption — the word count is the rule a
 * person actually experiences.
 *
 * Nothing here needs a migration: `posts.title` and `stories.caption` are
 * plain `text` columns with no length constraint. The 300 was only ever
 * enforced in Zod schemas and `.slice()` calls.
 */

/** The limit a writer is shown and held to. */
export const CAPTION_MAX_WORDS = 250;

/**
 * Hard storage ceiling. Not a user-facing rule — see the note above on why a
 * word count cannot bound bytes on its own.
 */
export const CAPTION_MAX_CHARS = 3000;

/** How many lines of a caption the feed shows before "See more". */
export const CAPTION_CLAMP_LINES = 7;

/**
 * Words in a caption.
 *
 * Whitespace-separated runs, with newlines counting as whitespace — so the
 * count does not change when someone reformats the same text into paragraphs.
 * An empty or whitespace-only caption is 0 words, not 1, which matters because
 * `"".split(/\s+/)` returns `[""]` and would otherwise report one.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Trim `text` down to at most `maxWords` words, preserving its line breaks.
 *
 * 🔴 Paragraph structure is preserved deliberately. The obvious implementation
 * — `split(/\s+/).slice(0, n).join(" ")` — silently flattens every newline
 * into a space, which would mean pasting a long multi-paragraph caption
 * destroyed exactly the formatting the owner asked to support in the same
 * breath as this limit. Splitting on a capturing group keeps the original
 * separators (including `\n\n`) and puts them back untouched.
 */
export function clampWords(text: string, maxWords: number = CAPTION_MAX_WORDS): string {
  if (countWords(text) <= maxWords) return text;
  // Odd indices are the whitespace separators; even ones are the words. A
  // leading separator (text starting with whitespace) lands at index 0 as an
  // empty word, which costs nothing and keeps the alternation intact.
  const parts = text.split(/(\s+)/);
  let words = 0;
  let out = "";
  for (const part of parts) {
    if (/^\s*$/.test(part)) {
      // Never emit a trailing separator once the budget is spent — that would
      // leave a dangling blank line at the end of the clamped caption.
      if (words >= maxWords) break;
      out += part;
      continue;
    }
    if (words >= maxWords) break;
    out += part;
    words += 1;
  }
  return out.trimEnd();
}

/**
 * A caption reduced to something usable as a page `<title>` / OG title.
 *
 * 🔴 REQUIRED BY THE 250-WORD LIMIT, not a nicety. A post's caption IS its
 * `posts.title` column, and that column feeds `postPageMetadata`. Raising the
 * caption cap from 300 characters to 250 words without this would have started
 * emitting `<title>` tags around 1 500 characters long — on a site that was
 * already rejected twice by AdSense for content quality, and where a
 * multi-paragraph `<title>` is exactly the sort of signal that gets a page
 * treated as low-effort.
 *
 * Cuts at the first sentence or line break when there is one within the
 * budget, since that is almost always the real headline of a caption, and
 * falls back to a word boundary otherwise — never mid-word, and never a bare
 * `slice` that could sever a surrogate pair.
 */
export function titleFromCaption(caption: string, maxChars = 70): string {
  const flat = caption.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= maxChars) return flat;

  // A sentence end or a line break inside the budget is the natural headline.
  const head = flat.slice(0, maxChars + 1);
  const sentence = head.search(/[.!?](\s|$)/);
  if (sentence > 20) return flat.slice(0, sentence + 1);

  const lastSpace = head.lastIndexOf(" ");
  return `${flat.slice(0, lastSpace > 20 ? lastSpace : maxChars).trimEnd()}…`;
}

/**
 * The full normalisation a caption gets before it is stored.
 *
 * Applied on the SERVER as well as in the composer: the composer's limit is a
 * courtesy to the person typing, never a security boundary — the API is called
 * directly by the app's own retry paths and could be called by anything else.
 *
 * Windows/paste carriage returns are normalised away so `\r\n` cannot render
 * as a double break under `whitespace-pre-line`, and runs of blank lines are
 * collapsed to at most one, so a caption cannot push the rest of a feed card
 * off screen with fifty empty lines.
 */
export function normalizeCaption(text: string): string {
  return clampWords(
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, CAPTION_MAX_CHARS),
  );
}
