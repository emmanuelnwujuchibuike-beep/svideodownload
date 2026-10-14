import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-14: a video ad shows full screen everywhere except the
 * download-result card and the feed card — inside the safe areas, full width,
 * with sponsor, title and description overlaid on the video's foot.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("full-screen video ads", () => {
  const layout = code("features/ads-platform/serve/fullscreen-video-ad.tsx");

  it("the media sits between the safe areas and is never cropped", () => {
    expect(layout).toContain('className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] top-[env(safe-area-inset-top)]"');
    expect(layout).toMatch(/<SelfAdCreative[\s\S]*?fit="contain"/);
  });

  it("🔴 sponsor, headline and description are overlaid on the video's foot, not stacked under it", () => {
    const foot = layout.slice(layout.indexOf("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t"));
    expect(foot.length).toBeLessThan(layout.length);
    expect(foot).toContain("{ad.sponsor}");
    expect(foot).toContain("{ad.headline}");
    expect(foot).toContain("{ad.body}");
  });

  it("TikTok/Snapchat grammar with no made-up numbers: rail of real actions, CTA that lights up, tap to pause", () => {
    expect(layout).toContain('aria-label="Share this ad"');
    expect(layout).toMatch(/setTimeout\(\(\) => setCtaLit\(true\), CTA_HIGHLIGHT_MS\)/);
    expect(layout).toMatch(/aria-label=\{paused \? "Play the ad" : "Pause the ad"\}/);
    // the truth rule: no like/comment/view counters on an ad
    expect(layout).not.toMatch(/likes|comments|views|formatCompactNumber/i);
  });

  it("the interstitial, the Stories card and the Reels slide use it for a video", () => {
    expect(code("features/ads-platform/serve/self-interstitial.tsx")).toMatch(/if \(ad\.mediaType === "video"\) \{[\s\S]*?<FullscreenVideoAd/);
    expect(code("features/ads-platform/serve/self-story-card.tsx")).toMatch(/if \(isVideo\) \{[\s\S]*?<FullscreenVideoAd/);
    expect(code("features/ads-platform/serve/paid-reels-slide.tsx")).toMatch(/if \(fullVideo && pick\) \{[\s\S]*?<FullscreenVideoAd/);
  });

  it("the download-result card and the feed card are untouched", () => {
    expect(code("features/ads-platform/serve/self-ad-banner.tsx")).not.toContain("FullscreenVideoAd");
    expect(code("features/ads-platform/serve/self-ad-card.tsx")).not.toContain("FullscreenVideoAd");
  });
});
