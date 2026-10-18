import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-17: "the video ad doesn't auto play in reels, and the bottom NAV is blocking the bottom
 * visit button". The Reels deck holds suspendPlayback() for its whole life (features/feed/reel-viewer.tsx,
 * ReelDeck), and the ad's autoplay refused to start while anything was suspended — so the deck's own ad
 * slide never played. And the full-screen layout stood its call to action on the safe area only, under
 * the app's floating nav. No DOM in this suite, so these guard the wiring the fix depends on.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const creative = code("features/ads-platform/serve/self-ad-creative.tsx");
const full = code("features/ads-platform/serve/fullscreen-video-ad.tsx");
const slide = code("features/ads-platform/serve/paid-reels-slide.tsx");
const deck = code("features/feed/reel-viewer.tsx");

describe("a Reels ad slide autoplays", () => {
  it("the deck really does hold the playback suspension (the cause)", () => {
    const start = deck.indexOf("export function ReelDeck(");
    expect(start).toBeGreaterThan(-1);
    expect(deck.indexOf("useLayoutEffect(() => suspendPlayback(), []);", start)).toBeGreaterThan(start);
  });

  it("an ad that IS the surface ignores the suspension; every other ad still obeys it", () => {
    expect(creative).toContain("(ownsSurface || !isSuspended())");
    expect(creative).toContain("ownsSurface = false,");
    // still only while half visible, the tab shown, and no dialog over it
    expect(creative).toMatch(/e\.isIntersecting && e\.intersectionRatio >= 0\.5 && document\.visibilityState === "visible" && \(ownsSurface \|\| !isSuspended\(\)\) && !dialogCovers\(v\)/);
  });

  it("the Reels slide is the ONLY caller that opts out of the suspension", () => {
    expect(slide).toMatch(/<FullscreenAd [^>]*\bownsSurface\b[^>]*\bnavClearance\b/);
    expect(full).toContain("ownsSurface={ownsSurface}");
    const dir = "features/ads-platform/serve";
    const others = readdirSync(join(process.cwd(), dir)).filter((f) => f.endsWith(".tsx") && f !== "paid-reels-slide.tsx" && f !== "fullscreen-video-ad.tsx" && f !== "self-ad-creative.tsx");
    for (const f of others) expect(code(`${dir}/${f}`), f).not.toMatch(/\bownsSurface\b/);
  });
});

describe("the call to action stands above the floating nav in Reels", () => {
  it("the clearance is the nav's published height beyond the safe area, 0 without a nav", () => {
    expect(full).toContain('"--ad-nav": "max(0px, calc(var(--frenz-bottomnav-h, 0px) - env(safe-area-inset-bottom)))"');
    expect(full).toMatch(/style=\{navClearance \?/);
  });

  it("the caption + CTA block rises by it (the engagement rail was removed, owner 2026-10-18)", () => {
    expect(full).toContain("pb-[calc(env(safe-area-inset-bottom)+var(--ad-nav,0px)+0.875rem)]");
    // the sound button lives in the creative and stands on the CTA
    expect(creative).toContain("bottom-[calc(var(--ad-cta,4.125rem)+var(--ad-nav,0px)+1.625rem)] right-3 h-11 w-11");
  });

  it("the nav still publishes that height", () => {
    expect(code("features/app-shell/mobile-nav.tsx")).toContain('root.style.setProperty("--frenz-bottomnav-h"');
  });
});
