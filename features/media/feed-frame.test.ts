import { describe, expect, it } from "vitest";

import { FEED_MIN_RATIO, feedFrameRatio, feedFrameStyle } from "./feed-frame";

describe("feed media frame: full width, capped at the owner's mark (2026-10-23)", () => {
  it("a long clip stops at 7:6 (height:width); shorter media keeps its own shape", () => {
    expect(feedFrameRatio(9 / 16)).toBe(FEED_MIN_RATIO);
    expect(feedFrameRatio(1)).toBe(1);
    expect(feedFrameRatio(16 / 9)).toBe(16 / 9);
    expect(feedFrameStyle(9 / 16)).toEqual({ width: "100%", aspectRatio: (6 / 7).toFixed(4) });
  });

  it("teeth: the cap is the marked height, about 1.17 × the width, not uncapped", () => {
    expect(1 / feedFrameRatio(0.3)).toBeCloseTo(1.1667, 3);
    expect(feedFrameRatio(null)).toBe(4 / 5 > FEED_MIN_RATIO ? 4 / 5 : FEED_MIN_RATIO);
  });
});
