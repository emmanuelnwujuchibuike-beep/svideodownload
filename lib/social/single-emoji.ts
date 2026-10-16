/**
 * Is this text ONE emoji — the case a story reply celebrates with emojis rising
 * up the screen (owner, 2026-10-15: "make suggestion Emoji to animate up and
 * disappear when a user use a single Emoji to reply to a story")?
 *
 * One grapheme (so a flag, a skin tone or a ZWJ family counts as one), made only
 * of pictographs and their joiners/modifiers. "😍😍" and "ok 😍" are not one.
 */
export function isSingleEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]+$/u.test(t)) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)) if (++n > 1) return false;
    return n === 1;
  }
  // no Segmenter: one pictograph at most (a ZWJ sequence still passes, its parts are joined)
  return (t.match(/\p{Extended_Pictographic}/gu) ?? []).length - (t.match(/\u200D/g) ?? []).length <= 1;
}
