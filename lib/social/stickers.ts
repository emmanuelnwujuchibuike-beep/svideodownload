/**
 * Sticker pack — asset-free, emoji-based graphics rendered large. A sticker id
 * is a short stable string stored on a comment (`post_comments.sticker`) or in a
 * member's saved set (`user_stickers.sticker`). Ids are validated on write so we
 * never store arbitrary strings in the sticker slot.
 */

export interface Sticker {
  id: string;
  /** The glyph(s) rendered at large size. */
  glyph: string;
  label: string;
  group: "reactions" | "love" | "hype" | "fun" | "support";
}

export const STICKERS: Sticker[] = [
  // reactions
  { id: "haha", glyph: "😂", label: "Haha", group: "reactions" },
  { id: "wow", glyph: "😮", label: "Wow", group: "reactions" },
  { id: "mindblown", glyph: "🤯", label: "Mind blown", group: "reactions" },
  { id: "cry", glyph: "😭", label: "Crying", group: "reactions" },
  { id: "think", glyph: "🤔", label: "Thinking", group: "reactions" },
  { id: "eyes", glyph: "👀", label: "Eyes", group: "reactions" },
  // love
  { id: "heart", glyph: "❤️", label: "Love", group: "love" },
  { id: "heart-eyes", glyph: "😍", label: "Heart eyes", group: "love" },
  { id: "hearts", glyph: "🥰", label: "Adore", group: "love" },
  { id: "kiss", glyph: "😘", label: "Kiss", group: "love" },
  { id: "sparkling-heart", glyph: "💖", label: "Sparkle heart", group: "love" },
  // hype
  { id: "fire", glyph: "🔥", label: "Fire", group: "hype" },
  { id: "hundred", glyph: "💯", label: "100", group: "hype" },
  { id: "clap", glyph: "👏", label: "Clap", group: "hype" },
  { id: "raised-hands", glyph: "🙌", label: "Hands up", group: "hype" },
  { id: "rocket", glyph: "🚀", label: "Rocket", group: "hype" },
  { id: "trophy", glyph: "🏆", label: "Trophy", group: "hype" },
  { id: "crown", glyph: "👑", label: "Crown", group: "hype" },
  // fun
  { id: "party", glyph: "🥳", label: "Party", group: "fun" },
  { id: "cool", glyph: "😎", label: "Cool", group: "fun" },
  { id: "wink", glyph: "😉", label: "Wink", group: "fun" },
  { id: "star-struck", glyph: "🤩", label: "Star-struck", group: "fun" },
  { id: "goat", glyph: "🐐", label: "GOAT", group: "fun" },
  { id: "sparkles", glyph: "✨", label: "Sparkles", group: "fun" },
  // support
  { id: "thumbs-up", glyph: "👍", label: "Nice", group: "support" },
  { id: "muscle", glyph: "💪", label: "Strong", group: "support" },
  { id: "pray", glyph: "🙏", label: "Thank you", group: "support" },
  { id: "gift", glyph: "🎁", label: "Gift", group: "support" },
  { id: "rose", glyph: "🌹", label: "Rose", group: "support" },
  { id: "salute", glyph: "🫡", label: "Salute", group: "support" },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function isStickerId(id: string): boolean {
  return BY_ID.has(id);
}

export function stickerGlyph(id: string | null | undefined): string | null {
  if (!id) return null;
  return BY_ID.get(id)?.glyph ?? null;
}

export const STICKER_GROUPS: { key: Sticker["group"]; label: string }[] = [
  { key: "reactions", label: "Reactions" },
  { key: "love", label: "Love" },
  { key: "hype", label: "Hype" },
  { key: "fun", label: "Fun" },
  { key: "support", label: "Support" },
];
