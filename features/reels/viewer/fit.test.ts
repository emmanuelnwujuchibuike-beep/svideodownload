import { describe, expect, it } from "vitest";

import { shouldFullBleed } from "./fit";

/**
 * 🔴 REWRITTEN 2026-08-17 — the owner's "premium edge-to-edge media viewer"
 * spec makes "never crop any part of the user's original media" priority #1,
 * explicitly including the standard 9:16 reel shape (its own test 1). That
 * overrides the "long views should reach the safe area at all cost"
 * instruction the OLD version of this file (and these tests) protected —
 * confirmed explicitly with the owner before this rewrite. See `fit.ts`'s
 * header for the full three-instruction history these tests used to pin;
 * `shouldFullBleed` now always returns false, so there is only one
 * meaningful case left to test.
 */
describe("shouldFullBleed", () => {
  it("never fills the screen, for any shape — nothing crops anymore", () => {
    expect(shouldFullBleed(9 / 16, 393 / 851)).toBe(false); // standard reel, was `true`
    expect(shouldFullBleed(9 / 21, 393 / 851)).toBe(false); // taller than 9:16, was `true`
    expect(shouldFullBleed(1, 393 / 851)).toBe(false); // square
    expect(shouldFullBleed(4 / 5, 393 / 851)).toBe(false);
    expect(shouldFullBleed(16 / 9, 393 / 851)).toBe(false); // landscape
    expect(shouldFullBleed(393 / 851, 393 / 851)).toBe(false); // exact match, was `true`
  });

  it("never crops on an unknown or degenerate size either", () => {
    expect(shouldFullBleed(0, 393 / 851)).toBe(false);
    expect(shouldFullBleed(NaN, 393 / 851)).toBe(false);
  });
});
