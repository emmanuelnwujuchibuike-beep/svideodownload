import { describe, expect, it } from "vitest";

import {
  applyRate,
  DEFAULT_RATE,
  formatRate,
  nearestRate,
  nextRate,
  PLAYBACK_RATES,
} from "./playback-rate";

/**
 * The dangerous case here is silent: an out-of-range `playbackRate` throws
 * nothing and logs nothing — the video just plays unwatchably fast, or mutes
 * itself because the engine stopped rendering audio. So the tests are about
 * what happens to values that should never have existed.
 */

describe("nearestRate", () => {
  it("keeps a value that is already on the ladder", () => {
    for (const r of PLAYBACK_RATES) expect(nearestRate(r)).toBe(r);
  });

  it("🔴 clamps a wild stored value instead of trusting it", () => {
    // localStorage is editable, and an older build may have written anything.
    // 16x is silent — no error, just an unusable video.
    expect(nearestRate(16)).toBe(2);
    expect(nearestRate(0.01)).toBe(0.5);
    expect(nearestRate(-3)).toBe(0.5);
  });

  it("falls back to 1x for a value that is not a number at all", () => {
    expect(nearestRate(Number.NaN)).toBe(DEFAULT_RATE);
    expect(nearestRate(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RATE);
  });

  it("snaps to the closer rung", () => {
    expect(nearestRate(1.3)).toBe(1.25);
    expect(nearestRate(1.45)).toBe(1.5);
    expect(nearestRate(0.6)).toBe(0.5);
    expect(nearestRate(0.7)).toBe(0.75);
  });
});

describe("nextRate", () => {
  it("walks the ladder in order and wraps", () => {
    let r: number = PLAYBACK_RATES[0];
    const seen = [r];
    for (let i = 0; i < PLAYBACK_RATES.length - 1; i++) {
      r = nextRate(r);
      seen.push(r);
    }
    expect(seen).toEqual([...PLAYBACK_RATES]);
    expect(nextRate(PLAYBACK_RATES[PLAYBACK_RATES.length - 1]!)).toBe(PLAYBACK_RATES[0]);
  });

  it("recovers onto the ladder from an off-ladder value", () => {
    expect(nextRate(1.3)).toBe(1.5); // 1.3 snaps to 1.25, next is 1.5
    expect(nextRate(99)).toBe(0.5); // snaps to 2, wraps
  });
});

describe("formatRate", () => {
  it("drops trailing zeros — '1.50×' reads like a price", () => {
    expect(formatRate(1)).toBe("1×");
    expect(formatRate(1.5)).toBe("1.5×");
    expect(formatRate(0.75)).toBe("0.75×");
    expect(formatRate(2)).toBe("2×");
  });
});

describe("applyRate", () => {
  it("sets the rate and pitch preservation, including the Safari spelling", () => {
    const el = {} as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    applyRate(el, 1.5);
    expect(el.playbackRate).toBe(1.5);
    // 🔴 Engines disagree on the default; the gap between a normal voice and a
    // chipmunk is not something to leave to the browser.
    expect(el.preservesPitch).toBe(true);
    expect(el.webkitPreservesPitch).toBe(true);
  });

  it("never throws on a null or detached element", () => {
    expect(() => applyRate(null, 1.5)).not.toThrow();
    const hostile = {
      set playbackRate(_v: number) {
        throw new Error("detached");
      },
    } as unknown as HTMLMediaElement;
    expect(() => applyRate(hostile, 2)).not.toThrow();
  });

  it("stays inside the range where browsers still render audio", () => {
    // Outside roughly 0.25x-4x engines mute or clamp. A muted reel at speed is
    // just a flicker, so the ladder must never leave that window.
    expect(Math.min(...PLAYBACK_RATES)).toBeGreaterThanOrEqual(0.25);
    expect(Math.max(...PLAYBACK_RATES)).toBeLessThanOrEqual(4);
  });
});
