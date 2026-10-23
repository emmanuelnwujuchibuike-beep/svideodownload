import { describe, expect, it } from "vitest";

import { MIN_SCORE, pickWinner, visibleScore } from "./feed-autoplay";

/** The feed's one autoplay election (2026-10-22) — every rule with a case that fails on a bad fixture. */

const entry = (visible: number, height: number, screen = 800) => ({ intersectionRect: { height: visible }, boundingClientRect: { height }, rootBounds: { height: screen } });

describe("how much of a clip counts as on screen", () => {
  it("is the share of the clip for one shorter than the screen", () => {
    expect(visibleScore(entry(200, 400), 800)).toBe(0.5);
    expect(visibleScore(entry(400, 400), 800)).toBe(1);
  });

  it("🔴 is the share of the SCREEN for a clip taller than it — a tall clip filling the screen wins outright", () => {
    // a 9:16 clip 1200 px tall on an 800 px screen can never be more than 2/3 visible as a share of itself
    expect(visibleScore(entry(800, 1200), 800)).toBe(1);
    expect(visibleScore(entry(400, 1200), 800)).toBe(0.5);
  });

  it("is nothing for an unsized or off-screen clip", () => {
    expect(visibleScore(entry(0, 0), 800)).toBe(0);
    expect(visibleScore(entry(0, 400), 800)).toBe(0);
  });
});

describe("the winner", () => {
  it("is the most visible clip", () => {
    expect(pickWinner([{ key: "a", score: 0.55, distanceFromCentre: 10 }, { key: "b", score: 0.95, distanceFromCentre: 300 }])).toBe("b");
  });

  it("🔴 teeth: a clip just peeking in below the fold never takes the turn", () => {
    expect(pickWinner([{ key: "below", score: MIN_SCORE - 0.01, distanceFromCentre: 0 }])).toBeNull();
    expect(pickWinner([{ key: "watched", score: 0.8, distanceFromCentre: 100 }, { key: "below", score: 0.3, distanceFromCentre: 350 }])).toBe("watched");
  });

  it("on a tie, the one nearer the middle of the screen", () => {
    expect(pickWinner([{ key: "top", score: 1, distanceFromCentre: 250 }, { key: "mid", score: 1, distanceFromCentre: 20 }])).toBe("mid");
  });

  it("nobody, when nothing is on screen", () => {
    expect(pickWinner([])).toBeNull();
  });
});
