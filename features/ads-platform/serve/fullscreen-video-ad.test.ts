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

  it("TikTok/Snapchat grammar: rail of real actions, CTA that lights up, tap to pause", () => {
    expect(layout).toContain('"Share this ad"');
    expect(layout).toMatch(/setTimeout\(\(\) => setCtaLit\(true\), CTA_HIGHLIGHT_MS\)/);
    expect(layout).toMatch(/aria-label=\{paused \? "Play the ad" : "Pause the ad"\}/);
  });

  it("🔴 likes, views and shares are the campaign's REAL counts — none shown before they load (owner, 2026-10-15)", () => {
    // read from the engagement route only, never computed or seeded here
    expect(layout).toContain("void loadAdEngagement(ad.c).then((e) => {");
    expect(layout).toContain("const [counts, setCounts] = useState<AdEngagement | null>(null);");
    // the views item exists only once counts are in; the like button says "Like" until then
    expect(layout).toContain("{counts ? (\n            <div className=\"flex flex-col items-center gap-1\" aria-label={`${counts.views} views`}>");
    expect(layout).toContain('{counts ? formatCompactNumber(counts.likes) : "Like"}');
    // no literal number is ever rendered as a count
    expect(layout).not.toMatch(/formatCompactNumber\(\d/);
    // an optimistic like is rolled back when the server refuses it
    expect(layout).toContain("setCounts(after ?? before);");
    // a share is counted only after it really happened
    expect(layout.indexOf('void reactToAd(ad.c, "share", true)')).toBeGreaterThan(layout.indexOf("await navigator.share(data);"));
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
