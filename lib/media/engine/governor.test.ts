import { describe, expect, it } from "vitest";

import { classifyDevice } from "./capabilities";
import {
  decidePolicy,
  policyChanged,
  DISTRESS_DROPPED_RATIO,
  DISTRESS_REBUFFERS,
  type PlaybackSignals,
} from "./governor";

/**
 * The governor is a policy with ORDERING rules, and the bug in that kind of code
 * is never inside one branch — it is which branch wins. These tests are written
 * against the conflicts, not against the happy paths.
 */

const base: PlaybackSignals = {
  preference: "auto",
  saveData: false,
  effectiveType: "4g",
  deviceClass: "mid",
};

const withSignals = (over: Partial<PlaybackSignals>) => decidePolicy({ ...base, ...over });

describe("decidePolicy — the four quality preferences", () => {
  it("data-saver caps at 480p and buys no speculative segments", () => {
    const p = withSignals({ preference: "data-saver" });
    expect(p.maxHeight).toBe(480);
    expect(p.fullyBufferAhead).toBe(0);
  });

  it("data-saver still MOUNTS a neighbour — an unmounted one is a black frame", () => {
    // The saving comes from not fetching segments, not from an empty deck.
    const p = withSignals({ preference: "data-saver" });
    expect(p.preloadAhead).toBeGreaterThanOrEqual(1);
    expect(p.preloadBehind).toBeGreaterThanOrEqual(1);
  });

  it("balanced caps at 720p", () => {
    expect(withSignals({ preference: "balanced" }).maxHeight).toBe(720);
  });

  it("high removes the cap", () => {
    expect(withSignals({ preference: "high" }).maxHeight).toBeNull();
  });

  it("auto leaves an unconstrained device uncapped", () => {
    expect(withSignals({}).maxHeight).toBeNull();
  });
});

describe("decidePolicy — an explicit preference beats every heuristic", () => {
  it("data-saver wins over a fast connection and a full battery", () => {
    const p = withSignals({
      preference: "data-saver",
      effectiveType: "4g",
      batteryLevel: 1,
      charging: true,
      deviceClass: "high",
    });
    expect(p.maxHeight).toBe(480);
  });

  it("high wins over a 2G connection — the viewer asked, and it is their data", () => {
    expect(withSignals({ preference: "high", effectiveType: "2g" }).maxHeight).toBeNull();
  });
});

describe("decidePolicy — distress", () => {
  it("🔴 steps DOWN even under 'high', because a stuttering rung is not quality", () => {
    const clean = withSignals({ preference: "high", deviceClass: "high" });
    const hot = withSignals({
      preference: "high",
      deviceClass: "high",
      droppedFrameRatio: DISTRESS_DROPPED_RATIO,
    });
    expect(clean.maxHeight).toBeNull();
    expect(hot.maxHeight).toBe(720);
    expect(hot.reason.some((r) => r.startsWith("distress:"))).toBe(true);
  });

  it("🔴 is not overridden by a GOOD bandwidth reading — the device is the constraint", () => {
    const p = withSignals({
      effectiveType: "4g",
      downlinkMbps: 50,
      deviceClass: "high",
      droppedFrameRatio: 0.2,
    });
    expect(p.maxHeight).not.toBeNull();
    expect(p.maxHeight).toBeLessThanOrEqual(720);
  });

  it("treats repeated rebuffering as distress too", () => {
    const p = withSignals({ rebuffers: DISTRESS_REBUFFERS });
    expect(p.reason.some((r) => r.startsWith("distress:rebuffers"))).toBe(true);
    expect(p.maxHeight).toBe(720);
  });

  it("does nothing below the thresholds", () => {
    const p = withSignals({ droppedFrameRatio: 0.01, rebuffers: 1 });
    expect(p.reason.some((r) => r.startsWith("distress:"))).toBe(false);
    expect(p.maxHeight).toBeNull();
  });

  it("keeps stepping down as distress compounds, and never below the floor", () => {
    let height = withSignals({ effectiveType: "2g" }).maxHeight; // 360
    expect(height).toBe(360);
    const p = withSignals({ effectiveType: "2g", droppedFrameRatio: 0.5 });
    expect(p.maxHeight).toBe(360); // already at the floor — cannot go lower
    height = p.maxHeight;
    expect(height).toBeGreaterThan(0);
  });
});

describe("decidePolicy — buffers track the BINDING constraint", () => {
  it("lengthens the runway on a weak link, where the failure is a stall", () => {
    const weak = withSignals({ effectiveType: "3g" });
    const good = withSignals({ effectiveType: "4g" });
    expect(weak.forwardBufferSec).toBeGreaterThan(good.forwardBufferSec);
  });

  it("shortens it on a struggling DEVICE, where the failure is memory and heat", () => {
    const hot = withSignals({ effectiveType: "3g", droppedFrameRatio: 0.3 });
    const weak = withSignals({ effectiveType: "3g" });
    expect(hot.forwardBufferSec).toBeLessThan(weak.forwardBufferSec);
    expect(hot.backBufferSec).toBeLessThanOrEqual(2);
  });

  it("keeps a low-end device on a short back buffer regardless of network", () => {
    expect(withSignals({ deviceClass: "low", effectiveType: "4g" }).backBufferSec).toBeLessThanOrEqual(2);
  });
});

describe("decidePolicy — the preload budget", () => {
  it("spends nothing speculative on 2G or a critical battery", () => {
    expect(withSignals({ effectiveType: "2g" }).fullyBufferAhead).toBe(0);
    expect(withSignals({ batteryLevel: 0.05, charging: false }).fullyBufferAhead).toBe(0);
  });

  it("deepens for a demonstrably engaged viewer, not merely a fast one", () => {
    const flicking = withSignals({ completedClips: 0 });
    const watching = withSignals({ completedClips: 5 });
    expect(watching.preloadAhead).toBeGreaterThan(flicking.preloadAhead);
    expect(watching.fullyBufferAhead).toBeGreaterThan(flicking.fullyBufferAhead);
  });

  it("goes deepest only when the viewer asked for quality AND the device can take it", () => {
    const deep = withSignals({ preference: "high", deviceClass: "high" });
    const notDeep = withSignals({ preference: "high", deviceClass: "low" });
    expect(deep.preloadAhead).toBe(4);
    expect(notDeep.preloadAhead).toBeLessThan(4);
  });

  it("always keeps the previous clip mounted so scrolling back never re-fetches", () => {
    for (const over of [{}, { effectiveType: "2g" }, { deviceClass: "low" as const }, { batteryLevel: 0.05, charging: false }]) {
      expect(withSignals(over).preloadBehind).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("decidePolicy — startup bandwidth guess", () => {
  it("is seeded from the connection class, not a constant", () => {
    expect(withSignals({ effectiveType: "2g" }).startBitrateEstimate).toBeLessThan(
      withSignals({ effectiveType: "3g" }).startBitrateEstimate,
    );
    expect(withSignals({ effectiveType: "3g" }).startBitrateEstimate).toBeLessThan(
      withSignals({ effectiveType: "4g" }).startBitrateEstimate,
    );
  });
});

describe("decidePolicy — invariants that must hold for EVERY signal combination", () => {
  const prefs = ["auto", "data-saver", "balanced", "high"] as const;
  const types = [undefined, "slow-2g", "2g", "3g", "4g"];
  const classes = ["low", "mid", "high"] as const;

  it("never returns a nonsensical policy", () => {
    for (const preference of prefs)
      for (const effectiveType of types)
        for (const deviceClass of classes)
          for (const saveData of [false, true])
            for (const droppedFrameRatio of [0, 0.3])
              for (const batteryLevel of [undefined, 0.05, 0.5]) {
                const p = decidePolicy({
                  preference,
                  saveData,
                  effectiveType,
                  deviceClass,
                  droppedFrameRatio,
                  batteryLevel,
                  charging: batteryLevel === undefined ? undefined : false,
                });
                // A cap, if any, must be a real rung.
                if (p.maxHeight !== null) expect([360, 480, 720, 1080]).toContain(p.maxHeight);
                // Buffers must be positive and ordered.
                expect(p.forwardBufferSec).toBeGreaterThan(0);
                expect(p.maxForwardBufferSec).toBeGreaterThanOrEqual(p.forwardBufferSec);
                expect(p.backBufferSec).toBeGreaterThanOrEqual(0);
                // You cannot fully buffer more clips than you have mounted.
                expect(p.fullyBufferAhead).toBeLessThanOrEqual(p.preloadAhead);
                // Forward-scrolling dominates: never keep more behind than ahead.
                expect(p.preloadBehind).toBeLessThanOrEqual(p.preloadAhead);
                // Every decision is explainable.
                expect(Array.isArray(p.reason)).toBe(true);
              }
  });
});

describe("policyChanged — reconfiguring mid-playback is not free", () => {
  it("ignores a difference too small to be worth a reconfigure", () => {
    const a = withSignals({});
    const b = { ...a, forwardBufferSec: a.forwardBufferSec + 1 };
    expect(policyChanged(a, b)).toBe(false);
  });

  it("acts on a ceiling change", () => {
    expect(policyChanged(withSignals({}), withSignals({ preference: "balanced" }))).toBe(true);
  });

  it("acts on a preload-budget change", () => {
    expect(policyChanged(withSignals({ completedClips: 0 }), withSignals({ completedClips: 5 }))).toBe(true);
  });
});

describe("classifyDevice", () => {
  it("reads a small phone as low-end", () => {
    expect(classifyDevice(2, 4)).toBe("low");
    expect(classifyDevice(1, undefined)).toBe("low");
  });

  it("reads a workstation as high-end", () => {
    expect(classifyDevice(16, 12)).toBe("high");
  });

  it("🔴 calls an UNKNOWN device mid, never high", () => {
    // Safari exposes neither hint and is a large share of this app's traffic.
    // Guessing "high" would push the heaviest ladder at exactly the population
    // we cannot measure.
    expect(classifyDevice(undefined, undefined)).toBe("mid");
  });
});
