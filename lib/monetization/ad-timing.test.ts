import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { effectiveSkipSeconds } from "./ad-timing";

/**
 * The rule the owner stated twice (2026-08-30):
 *
 *   "time should be according to the ad network timer"
 *   "make same rule for the exoclick and others video ad in wallpaper download
 *    reward video or anywhere that is on 30sec or 10secs to be skipable when the
 *    ad finishes in the ad network, admin timer set up should only be a fallback"
 *
 * `vast-interstitial.test.ts` proves the arithmetic. This file proves the rule is
 * actually WIRED at every gate — which is the half that silently rots. Each gate
 * had its own hand-rolled `setInterval` counting down from an admin number, and
 * a new one written the same way would pass every arithmetic test in the suite
 * while reintroducing exactly the bug.
 *
 * Asserted against the source text, same technique as the service-worker and
 * landing-budget tests: the behaviour is a wiring decision, so wiring is what
 * gets asserted.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("every gated ad obeys the network's own timer", () => {
  it("🔴 the wallpaper reward gate no longer runs its own countdown", () => {
    const src = read("features", "monetization", "wallpaper-reward-gate.tsx");
    expect(
      src.includes("useAdGateCountdown"),
      "wallpaper-reward-gate.tsx stopped using useAdGateCountdown — its 5s/10s admin " +
        "number is back to being a fixed countdown that ignores how long the ad really is.",
    ).toBe(true);
    // The hand-rolled timer this replaced.
    expect(src).not.toMatch(/setTimeout\(\(\) => setRemaining/);
  });

  it("🔴 the download interstitial no longer runs its own countdown", () => {
    const src = read("features", "monetization", "download-interstitial.tsx");
    expect(src.includes("useAdGateCountdown")).toBe(true);
    expect(src).not.toMatch(/setRemaining\(skipSeconds\)/);
  });

  it("🔴 the player reports duration AND end upward", () => {
    // Without this the gates above have nothing to obey and silently fall back
    // to the admin number for every ad — the bug, wearing the fix's clothes.
    const src = read("features", "monetization", "exoclick-unit.tsx");
    expect(src).toMatch(/onAdTiming\?\.\(\{\s*durationSeconds/);
    expect(src).toMatch(/onAdTiming\?\.\(\{ durationSeconds: null, ended: true \}\)/);
  });

  it("🔴 the timing survives the whole chain: player → AdSlot → interstitial", () => {
    // A prop dropped at any link silently disables the rule for every
    // full-screen gate at once, with no type error at the call sites.
    expect(read("features", "monetization", "ad-slot.tsx")).toContain("onAdTiming={onAdTiming}");
    expect(read("features", "monetization", "fullscreen-interstitial.tsx")).toContain(
      "onAdTiming={onAdTiming}",
    );
  });

  it("🔴 the HD reward gate's Skip control is reachable on a short ad", () => {
    /*
      `watched` is clamped to `required`, and `required` is clamped to the real
      video length. So an UNCAPPED `skipAfterSec` above that length is a button
      that counts down and then never enables — on a modal whose entire premise
      is that this ad may be skipped.
    */
    const src = read("features", "monetization", "rewarded-ad.tsx");
    expect(src).toMatch(/Math\.min\(skipAfterSec, required\)/);
  });

  it("the VAST overlay caps its skip by the creative, not just the setting", () => {
    const src = read("features", "monetization", "vast-interstitial", "overlay.ts");
    expect(src).toContain("effectiveSkipSeconds");
    expect(src).toContain("skipRemainingSeconds");
    // The wall-clock decrement it replaced.
    expect(src).not.toMatch(/remaining = Math\.max\(0, remaining - 1\)/);
  });
});

describe("the fallback is a fallback, not the default path", () => {
  it("uses the admin number only when the network reports nothing", () => {
    // A display creative has no timeline at all. This is the ONLY case where the
    // admin number should decide, and it must still work.
    expect(effectiveSkipSeconds({ configuredSeconds: 30 })).toBe(30);
    expect(effectiveSkipSeconds({ configuredSeconds: 10, vastDurationSeconds: null })).toBe(10);
  });

  it("🔴 a 30s admin gate over a 12s fill releases at 12s", () => {
    // The owner's "30sec or 10secs" case, stated as a number.
    expect(effectiveSkipSeconds({ configuredSeconds: 30, vastDurationSeconds: 12 })).toBe(12);
    expect(effectiveSkipSeconds({ configuredSeconds: 10, mediaDurationSeconds: 4 })).toBe(4);
  });
});
