import { describe, expect, it } from "vitest";

import { likesAfterTap } from "./engagement";

// owner, 2026-10-16: a like shows +1 on the tap; the ×10 total shows on the next load
describe("likesAfterTap", () => {
  const before = { views: 1000, likes: 120, shares: 4, liked: false };
  it("a confirmed like adds exactly one, even when the server answers with the ×10 total", () => {
    expect(likesAfterTap(before, { views: 1010, likes: 130, shares: 4, liked: true })).toEqual({ views: 1010, likes: 121, shares: 4, liked: true });
  });
  it("a confirmed unlike takes exactly one away", () => {
    expect(likesAfterTap({ ...before, liked: true }, { views: 1000, likes: 110, shares: 4, liked: false }).likes).toBe(119);
  });
  it("a refused tap (liked unchanged on the server) leaves the count as it was", () => {
    expect(likesAfterTap(before, { ...before, likes: 999, liked: false }).likes).toBe(120);
  });
  it("no answer: what was shown before", () => {
    expect(likesAfterTap(before, null)).toBe(before);
  });
  it("never below zero", () => {
    expect(likesAfterTap({ ...before, likes: 0, liked: true }, { ...before, likes: 0, liked: false }).likes).toBe(0);
  });
});
