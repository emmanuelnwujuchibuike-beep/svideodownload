import { describe, expect, it } from "vitest";

import { propainterResizeRatio } from "./propainter-plan";

/**
 * The GPU budget arithmetic, pinned to the runs it was calibrated on.
 *
 * Three OOMs so far, three different allocations. The numbers below are the
 * account's own successes and failures (2026-09-09 and 2026-09-13), so a
 * "tidy-up" that moves a budget shows up here as a run that is known to have
 * died being declared safe.
 */
const AREA_BUDGET = 614_400; // config default — 640x960
const FRAME_BUDGET = 300_000_000; // config default — pixel-frames

describe("propainterResizeRatio — area budget (second OOM, 2026-09-09)", () => {
  it("leaves a clip under the area budget alone", () => {
    expect(propainterResizeRatio(480, 854, AREA_BUDGET)).toBe(1);
  });

  it("reduces a 1080p clip to the ratio that meets the area budget, rounded down", () => {
    const r = propainterResizeRatio(1080, 1920, AREA_BUDGET);
    expect(r).toBeLessThan(1);
    expect(1080 * 1920 * r * r).toBeLessThanOrEqual(AREA_BUDGET);
    expect(r).toBe(Math.floor(Math.sqrt(AREA_BUDGET / (1080 * 1920)) * 100) / 100);
  });

  it("gives an unknown size the full ratio — no evidence is not evidence of a large clip", () => {
    expect(propainterResizeRatio(null, null, AREA_BUDGET)).toBe(1);
    expect(propainterResizeRatio(0, 1920, AREA_BUDGET)).toBe(1);
  });
});

describe("propainterResizeRatio — frame budget (third OOM, 2026-09-13)", () => {
  it("🔴 the run that died — 1049 frames of 720x1280 — is reduced below the ratio that OOM'd", () => {
    const r = propainterResizeRatio(720, 1280, AREA_BUDGET, 1049, FRAME_BUDGET);
    expect(r).toBeLessThan(0.81); // 0.81 is what it ran at when it died
    expect(720 * 1280 * r * r * 1049).toBeLessThanOrEqual(FRAME_BUDGET);
  });

  it("the run that lived — a 9 s 1080p clip — keeps exactly today's ratio", () => {
    const frames = Math.round(9.101 * 30);
    const withoutFrames = propainterResizeRatio(1080, 1920, AREA_BUDGET);
    const withFrames = propainterResizeRatio(1080, 1920, AREA_BUDGET, frames, FRAME_BUDGET);
    expect(withFrames).toBe(withoutFrames);
    expect(1080 * 1920 * withFrames * withFrames * frames).toBeLessThanOrEqual(FRAME_BUDGET);
  });

  it("a short clip under both budgets is untouched", () => {
    expect(propainterResizeRatio(480, 854, AREA_BUDGET, 150, FRAME_BUDGET)).toBe(1);
  });

  it("a long clip that fits the AREA budget is still reduced by the FRAME budget", () => {
    // 480x854 is under the area budget; 1800 frames of it is not under the frame budget.
    const r = propainterResizeRatio(480, 854, AREA_BUDGET, 1800, FRAME_BUDGET);
    expect(r).toBeLessThan(1);
    expect(480 * 854 * r * r * 1800).toBeLessThanOrEqual(FRAME_BUDGET);
  });

  it("an unknown frame count applies no frame budget", () => {
    expect(propainterResizeRatio(480, 854, AREA_BUDGET, null, FRAME_BUDGET)).toBe(1);
    expect(propainterResizeRatio(480, 854, AREA_BUDGET, 0, FRAME_BUDGET)).toBe(1);
  });

  it("never goes below the floor", () => {
    expect(propainterResizeRatio(1080, 1920, AREA_BUDGET, 100_000, FRAME_BUDGET)).toBe(0.1);
  });
});
