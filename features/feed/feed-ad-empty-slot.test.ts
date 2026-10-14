import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { planSeesAd } from "@/lib/monetization/plan-ads";

/**
 * Owner, 2026-10-14: "I see empty ad slot in feed … reels and feed ad can show on
 * Pro but not on Business plan". The HilltopAds feed wrapper labelled itself
 * "Sponsored" for everyone while its unit drew only for the free plan, and the
 * feed_inline slot held a 250px box open when its unit never answered.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("feed ads: no empty slot, Pro yes, Business no", () => {
  it("the plan rule: Pro sees the feed and reels ads, Business sees none", () => {
    expect(planSeesAd("pro", "feed_inline")).toBe(true);
    expect(planSeesAd("pro", "reels_interstitial")).toBe(true);
    expect(planSeesAd("business", "feed_inline")).toBe(false);
    expect(planSeesAd("business", "reels_interstitial")).toBe(false);
  });

  it("🔴 the HilltopAds feed unit follows the feed rule, and labels only a painted creative", () => {
    const s = code("features/feed/hilltop-feed-ad.tsx");
    expect(s).toContain('useShowAds("feed_inline")');
    expect(s).toContain('placement="feed_inline"');
    expect(s).toMatch(/if \(!ready \|\| !showAds\) return null;/);
    expect(s).toMatch(/\{painted \? \(\s*<p[^>]*>\s*Sponsored/);
    expect(code("features/monetization/hilltop-slot.tsx")).toContain("useShowAds(placement)");
  });

  it("🔴 the feed_inline slot gives up its reserved box when no answer comes", () => {
    const s = code("features/feed/feed-ad-slot.tsx");
    expect(s).toMatch(/setFilled\(\(f\) => \(f === null \? false : f\)\), RESERVE_FOR_MS\)/);
    expect(s).toContain('filled !== false && "my-4 first:mt-0"');
    expect(code("features/monetization/ad-surface.tsx")).toMatch(/if \(noProvider\) onResolved\?\.\(false\)/);
  });
});
