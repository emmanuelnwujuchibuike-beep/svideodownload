import { describe, expect, it } from "vitest";

import { milestoneCrossed } from "./milestones";

const LADDER = [100, 500, 1_000, 5_000];

describe("milestoneCrossed", () => {
  it("returns the milestone when a count crosses it going up", () => {
    expect(milestoneCrossed(99, 100, LADDER)).toBe(100);
    expect(milestoneCrossed(95, 105, LADDER)).toBe(100);
  });

  it("returns null when no milestone is crossed", () => {
    expect(milestoneCrossed(50, 60, LADDER)).toBeNull();
    expect(milestoneCrossed(101, 102, LADDER)).toBeNull();
  });

  it("returns null when the count goes down (unfollow) even across a threshold", () => {
    expect(milestoneCrossed(105, 95, LADDER)).toBeNull();
    expect(milestoneCrossed(100, 99, LADDER)).toBeNull();
  });

  it("returns null when the count is unchanged", () => {
    expect(milestoneCrossed(100, 100, LADDER)).toBeNull();
  });

  it("returns the LARGEST milestone crossed, never fires more than one at once", () => {
    expect(milestoneCrossed(50, 600, LADDER)).toBe(500);
    expect(milestoneCrossed(0, 10_000, LADDER)).toBe(5_000);
  });

  it("does not re-fire a milestone once already at or past it (guards the unfollow/refollow flap case at the crossing boundary)", () => {
    // Already at 100, ticks up to 101 — 100 isn't crossed again.
    expect(milestoneCrossed(100, 101, LADDER)).toBeNull();
  });
});
