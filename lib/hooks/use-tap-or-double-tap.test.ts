import { describe, expect, it } from "vitest";

import { isDoubleTap } from "./use-tap-or-double-tap";

/**
 * The "Most important acceptance criterion" from the owner's feed-interaction
 * spec (2026-08-17): "Double tap → Reels opens" must NEVER happen. This is
 * the exact timestamp comparison `useTapOrDoubleTap`'s `onPointerUp` makes to
 * decide whether a tap is the second half of a double-tap (fire Wow, cancel
 * the pending expand) or a fresh single tap (schedule the expand).
 */
describe("isDoubleTap", () => {
  it("is NOT a double-tap on the very first tap ever (no prior tap pending)", () => {
    expect(isDoubleTap(1_000, 0, 300)).toBe(false);
  });

  it("is NOT a double-tap when the gap exceeds the threshold", () => {
    // 301ms after a tap at t=0, threshold 300ms — just outside the window.
    expect(isDoubleTap(301, 0 + 0, 300)).toBe(false);
    expect(isDoubleTap(1_500, 1_000, 300)).toBe(false);
  });

  it("IS a double-tap when the second tap lands well within the threshold", () => {
    expect(isDoubleTap(1_100, 1_000, 300)).toBe(true); // 100ms gap
    expect(isDoubleTap(1_050, 1_000, 300)).toBe(true); // fast double-tap, 50ms gap
  });

  it("is exclusive at the exact boundary (gap === threshold is NOT a double-tap)", () => {
    expect(isDoubleTap(1_300, 1_000, 300)).toBe(false);
  });

  it("is NOT a double-tap immediately after a double-tap was already consumed", () => {
    // The hook resets lastTapAt to 0 (the sentinel) once a double-tap fires —
    // simulates tap 1 (t=0) + tap 2 (t=100, consumes as a double, resets to 0)
    // + tap 3 (t=150): tap 3 must start a FRESH single-tap cycle, not double
    // up against the already-spent tap 2. Covers spec section 15 test 5:
    // "Triple tap → should not produce multiple unwanted navigations."
    expect(isDoubleTap(150, 0, 300)).toBe(false);
  });

  it("configurable threshold (spec: 'approximately 250-350ms, configurable')", () => {
    expect(isDoubleTap(1_260, 1_000, 250)).toBe(false); // 260ms gap, 250ms threshold
    expect(isDoubleTap(1_200, 1_000, 250)).toBe(true); // 200ms gap, 250ms threshold
    expect(isDoubleTap(1_340, 1_000, 350)).toBe(true); // 340ms gap, 350ms threshold
  });
});
