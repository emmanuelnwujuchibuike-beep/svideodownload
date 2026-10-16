import { describe, expect, it } from "vitest";

import { isSingleEmoji } from "./single-emoji";

describe("a single-emoji story reply", () => {
  it("one emoji, including a heart with its variation selector, a skin tone, a ZWJ family and a flag", () => {
    for (const e of ["😍", "😂", "😮", "❤️", "👍🏽", "👨‍👩‍👧", "🇳🇬", " 🔥 "]) expect(isSingleEmoji(e), e).toBe(true);
  });
  it("teeth: two emojis, text, text with an emoji, digits and empty are not", () => {
    for (const e of ["😍😍", "ok 😍", "lol", "1", "#", "", "   "]) expect(isSingleEmoji(e), JSON.stringify(e)).toBe(false);
  });
});
