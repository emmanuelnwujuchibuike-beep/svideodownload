import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-14: a video ad shows full screen everywhere except the
 * download-result card and the feed card — inside the safe areas, full width,
 * with sponsor, title and description overlaid on the video's foot.
 */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("full-screen ads (image and video)", () => {
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

  it("🔴 the interstitial, the Stories card and the Reels slide use it for EVERY ad, image or video", () => {
    const inter = code("features/ads-platform/serve/self-interstitial.tsx");
    expect(inter).toContain("<FullscreenAd");
    expect(inter).not.toContain('ad.mediaType === "video"');
    // the half-height sheet is gone
    expect(inter).not.toContain("max-w-md overflow-hidden rounded-t-[1.75rem]");
    const story = code("features/ads-platform/serve/self-story-card.tsx");
    expect(story).toContain("<FullscreenAd");
    expect(story).not.toContain("isVideo");
    expect(code("features/ads-platform/serve/paid-reels-slide.tsx")).toContain("const fullVideo = !!pick && !videoFailed;");
    // an image's progress fills over its time; only a video can be paused
    expect(layout).toContain("transitionDuration: `${imageMs}ms`");
    expect(layout).toMatch(/\{isVideo \? <button type="button" aria-label=\{paused \? "Play the ad"/);
  });

  it("the download-result card and the feed card are untouched", () => {
    expect(code("features/ads-platform/serve/self-ad-banner.tsx")).not.toContain("FullscreenVideoAd");
    expect(code("features/ads-platform/serve/self-ad-card.tsx")).not.toContain("FullscreenVideoAd");
  });
});

describe("the Ad tag never covers the creative", () => {
  it("🔴 the card and the History tile carry it in their text row; only the 32 px strip overlays it", () => {
    const s = code("features/ads-platform/serve/self-ad-banner.tsx");
    expect(s).toContain('{variant === "strip" ? label : null}');
    expect(s.match(/\{label\}/g) ?? []).toHaveLength(0);
    expect(s).toMatch(/>Ad<\/span>\s*<span className="truncate">Sponsored · \{current\.sponsor\}/);
  });
});
