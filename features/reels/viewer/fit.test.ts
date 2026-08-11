import { describe, expect, it } from "vitest";

import { shouldFullBleed, TALL_CLIP_ASPECT } from "./fit";

/**
 * The fit rule has been rewritten three times by three owner instructions, and
 * each rewrite regressed a case the previous one had got right. These are those
 * cases, pinned by shape and named by the instruction they come from — so the
 * NEXT change to the rule has to state which of them it intends to break.
 */

// 393x851 — the phone the reports come from.
const PHONE = 393 / 851; // 0.4618
// 430x932 — a larger phone, slightly different but the same family.
const BIG_PHONE = 430 / 932; // 0.4614
// A tablet in portrait, where the screen is much less elongated.
const TABLET = 834 / 1194; // 0.6985

const SQUARE = 1;
const PORTRAIT_4_5 = 4 / 5;
const PORTRAIT_2_3 = 2 / 3;
const REEL_9_16 = 9 / 16;
const TALL_9_21 = 9 / 21;
const LANDSCAPE_16_9 = 16 / 9;

describe("shouldFullBleed", () => {
  it("fills for a standard 9:16 reel — 'long views should reach the safe area at all cost'", () => {
    expect(shouldFullBleed(REEL_9_16, PHONE)).toBe(true);
    expect(shouldFullBleed(REEL_9_16, BIG_PHONE)).toBe(true);
  });

  it("fills for anything TALLER than 9:16", () => {
    expect(shouldFullBleed(TALL_9_21, PHONE)).toBe(true);
  });

  it("🔴 does NOT fill for a SQUARE clip — 'i said only long videos'", () => {
    expect(shouldFullBleed(SQUARE, PHONE)).toBe(false);
    expect(shouldFullBleed(SQUARE, BIG_PHONE)).toBe(false);
  });

  it("does not fill for the in-between portrait shapes — 'shorter videos should show their respective size'", () => {
    expect(shouldFullBleed(PORTRAIT_4_5, PHONE)).toBe(false);
    expect(shouldFullBleed(PORTRAIT_2_3, PHONE)).toBe(false);
  });

  it("does not fill for landscape", () => {
    expect(shouldFullBleed(LANDSCAPE_16_9, PHONE)).toBe(false);
  });

  it("fills when the shapes already match, whatever the shape is", () => {
    // "only videos capable of full edge to edge should be full edge to edge."
    // A clip shot at exactly the device's aspect loses nothing to `cover`.
    expect(shouldFullBleed(PHONE, PHONE)).toBe(true);
    expect(shouldFullBleed(TABLET, TABLET)).toBe(true);
    expect(shouldFullBleed(LANDSCAPE_16_9, LANDSCAPE_16_9)).toBe(true);
  });

  it("holds the 1.5% ceiling on how much a near-match may lose", () => {
    /*
      Measured on the TABLET on purpose. On a phone the screen is so elongated
      that anything near its shape is also inside the "tall clip" arm, so a
      near-match test there proves nothing about the ceiling — the second arm
      answers first. 0.6985 is squarer than 0.6, so only the ceiling is in play.
    */
    expect(shouldFullBleed(TABLET * 1.01, TABLET)).toBe(true); // ~1% lost
    expect(shouldFullBleed(TABLET * 1.05, TABLET)).toBe(false); // ~4.8% lost
    expect(shouldFullBleed(TABLET * 0.95, TABLET)).toBe(false); // and in the other direction
  });

  it("a clip slightly wider than 9:16 still fills a phone, by the TALL arm", () => {
    // 0.485 loses ~5% of its width on a 0.4618 phone, so the ceiling refuses it —
    // but it is more vertical than 9:16, and "long views should reach the safe
    // area at all cost". Documented because it looks like a contradiction.
    const nearlyPhoneShaped = PHONE * 1.05; // 0.485
    expect(nearlyPhoneShaped).toBeLessThan(TALL_CLIP_ASPECT);
    expect(shouldFullBleed(nearlyPhoneShaped, PHONE)).toBe(true);
  });

  it("🔴 refuses a square clip even on a tablet, where the shapes are closer", () => {
    // 0.6985 vs 1.0 still discards 30%. Route 1 must stay a NEAR-match test and
    // never widen into "close enough".
    expect(shouldFullBleed(SQUARE, TABLET)).toBe(false);
  });

  it("never crops on an unknown or degenerate size", () => {
    // A <video> reports 0x0 until metadata arrives.
    expect(shouldFullBleed(0, PHONE)).toBe(false);
    expect(shouldFullBleed(NaN, PHONE)).toBe(false);
    expect(shouldFullBleed(REEL_9_16, 0)).toBe(false);
    expect(shouldFullBleed(REEL_9_16, NaN)).toBe(false);
  });

  it("keeps the boundary where 9:16 is inside it and 2:3 is outside", () => {
    expect(REEL_9_16).toBeLessThanOrEqual(TALL_CLIP_ASPECT);
    expect(PORTRAIT_2_3).toBeGreaterThan(TALL_CLIP_ASPECT);
  });
});
