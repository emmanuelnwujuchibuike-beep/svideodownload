import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EligibleAd } from "@/lib/ads-platform/eligibility";

import { __resetWarm, isWarmed, mayWarm, takeWarmed, warm, warmUrlOf } from "./moment-warm";

const ad = (cr: string, over: Partial<EligibleAd> = {}): EligibleAd =>
  ({ c: "c1", cr, slot: null, mediaType: "image", media: `https://cdn.example/${cr}.webp`, thumb: null, url: "https://x.example", headline: null, body: null, sponsor: "S", duration: null, w: null, h: null, start: "", end: "", pages: [], ...over }) as EligibleAd;

afterEach(() => __resetWarm());

describe("Part 10: selective prefetch of the full-screen moments", () => {
  it("an image ad warms its image; a video ad warms only its poster — never the video", () => {
    expect(warmUrlOf(ad("a"))).toBe("https://cdn.example/a.webp");
    expect(warmUrlOf(ad("v", { mediaType: "video", media: "https://cdn.example/v.mp4", thumb: "https://cdn.example/v.jpg" }))).toBe("https://cdn.example/v.jpg");
    // teeth: a video with no poster warms nothing at all
    expect(warmUrlOf(ad("v2", { mediaType: "video", media: "https://cdn.example/v2.mp4", thumb: null }))).toBeNull();
  });

  it("Save-Data and 2G get nothing ahead of time", () => {
    expect(mayWarm({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(mayWarm({ effectiveType: "2g" })).toBe(false);
    expect(mayWarm({ effectiveType: "slow-2g" })).toBe(false);
    expect(mayWarm({ effectiveType: "4g" })).toBe(true);
    expect(mayWarm(undefined)).toBe(true);
  });

  it("the moment shows the ad it warmed — once — and only while it may still serve", () => {
    warm("download_completed_interstitial", ad("a"));
    expect(isWarmed("download_completed_interstitial")).toBe(true);
    expect(takeWarmed("download_completed_interstitial", [ad("a"), ad("b")], null)?.cr).toBe("a");
    // consumed
    expect(takeWarmed("download_completed_interstitial", [ad("a")], null)).toBeNull();
    // left the pool (campaign ended) → not shown
    warm("interstitial", ad("gone"));
    expect(takeWarmed("interstitial", [ad("b")], null)).toBeNull();
    // never the one shown last
    warm("interstitial", ad("b"));
    expect(takeWarmed("interstitial", [ad("b")], "b")).toBeNull();
  });

  it("warming reads the payload already in memory — it never makes an ad request", () => {
    const m = readFileSync(join(process.cwd(), "features/ads-platform/serve/moment-warm.ts"), "utf8");
    expect(m).not.toMatch(/fetch\(|loadSelfAds|<video|preload=/);
    const s = readFileSync(join(process.cwd(), "features/ads-platform/serve/self-moments.tsx"), "utf8");
    expect(s).toContain("takeWarmed(placement, e.pool.ads, lastShownCr(placement)) ?? nextFromPool(");
    expect(s).toContain(`warmFor("interstitial")`);
  });
});
