import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isStoryAd } from "./overlay";
import { MOMENTUM_MS, scrollIsGesture } from "./triggers";

/**
 * Owner, 2026-10-16: "the history that shows like reward is when I scroll much on history and it
 * starts happening". Two causes: the idle countdown ran out during a fling's momentum (no touch
 * event), and the ad it opened wore the download gate's chrome. Both pinned here.
 */

describe("momentum scroll counts as activity, restoration does not", () => {
  it("a scroll inside a gesture chain counts, to the chain's last frame", () => {
    const touch = 10_000;
    expect(scrollIsGesture(touch + 16, touch)).toBe(true);
    expect(scrollIsGesture(touch + MOMENTUM_MS, touch)).toBe(true);
  });

  it("a scroll with no gesture before it (the app restoring a position) does not", () => {
    expect(scrollIsGesture(5_000, 0)).toBe(false);
    expect(scrollIsGesture(10_000 + MOMENTUM_MS + 1, 10_000)).toBe(false);
  });

  it("the idle trigger listens for scroll and extends the chain on every frame", () => {
    const src = readFileSync(join(process.cwd(), "features", "monetization", "vast-interstitial", "triggers.tsx"), "utf8");
    expect(src).toContain('window.addEventListener("scroll", onScroll');
    expect(src).toMatch(/if \(!scrollIsGesture\(now, gestureAt\)\) return;\s*\/\/[^\n]*\n\s*gestureAt = now;/);
  });

  it("teeth: a check that ignores the gesture would count restoration as activity", () => {
    const naive = (_now: number, _at: number) => true;
    expect(naive(5_000, 0)).not.toBe(scrollIsGesture(5_000, 0));
  });
});

describe("any full-screen video on History is a story ad", () => {
  it("the between-media zone, anywhere", () => {
    expect(isStoryAd("history_story_ad", "/explore")).toBe(true);
  });

  it("the idle / back-swipe zone on the History library", () => {
    expect(isStoryAd("idle_interstitial", "/downloads")).toBe(true);
    expect(isStoryAd("idle_interstitial", "/downloads/")).toBe(true);
  });

  it("not elsewhere, and not a look-alike path", () => {
    expect(isStoryAd("idle_interstitial", "/explore")).toBe(false);
    expect(isStoryAd("download_complete", "/")).toBe(false);
    expect(isStoryAd("idle_interstitial", "/downloadsx")).toBe(false);
  });

  it("the History library's own idle ad carries no upgrade pitch", () => {
    const src = readFileSync(join(process.cwd(), "features", "monetization", "download-interstitial.tsx"), "utf8");
    expect(src).not.toMatch(/upsell=\{/);
  });
});
