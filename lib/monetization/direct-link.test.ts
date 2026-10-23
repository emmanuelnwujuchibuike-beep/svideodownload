import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIRECT_LINK,
  directLinkRollWins,
  isValidDirectLinkUrl,
  normalizeDirectLink,
  publicDirectLink,
} from "./direct-link";
import { planSeesAd } from "./plan-ads";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const OWNER_LINK = "https://uplcm.com/4/11476379";

describe("Monetag direct link (owner, 2026-10-16)", () => {
  it("accepts the owner's link and refuses anything a browser should not open", () => {
    expect(isValidDirectLinkUrl(OWNER_LINK)).toBe(true);
    for (const bad of ["http://uplcm.com/4/1", "javascript:alert(1)", "//uplcm.com/4/1", "uplcm.com/4/1", "https://u:p@uplcm.com/", "", 5]) {
      expect(isValidDirectLinkUrl(bad), String(bad)).toBe(false);
    }
  });

  it("ships off, and an old settings row without the key normalizes to off", () => {
    expect(DEFAULT_DIRECT_LINK.enabled).toBe(false);
    expect(normalizeDirectLink(undefined)).toEqual(DEFAULT_DIRECT_LINK);
  });

  it("a hand-edited row cannot switch it on with a string or smuggle a bad URL", () => {
    const n = normalizeDirectLink({ enabled: "true", url: "javascript:alert(1)", chancePercent: 900, spots: { wallpaper: "no" } });
    expect(n.enabled).toBe(false);
    expect(n.url).toBe("");
    expect(n.chancePercent).toBe(100);
    expect(n.spots.wallpaper).toBe(true);
  });

  it("is served only when Monetag is on, it is enabled, it has a URL and a spot", () => {
    const on = { enabled: true, url: OWNER_LINK, spots: { wallpaper: true, resultPreview: false, adClose: false }, chancePercent: 40 };
    expect(publicDirectLink(on, true)).toEqual({ url: OWNER_LINK, spots: ["wallpaper"], chancePercent: 40 });
    expect(publicDirectLink(on, false)).toBeNull();
    expect(publicDirectLink({ ...on, enabled: false }, true)).toBeNull();
    expect(publicDirectLink({ ...on, url: "" }, true)).toBeNull();
    expect(publicDirectLink({ ...on, spots: { wallpaper: false, resultPreview: false, adClose: false } }, true)).toBeNull();
  });

  it("the roll follows the chance: 100% always, 1% almost never", () => {
    expect(directLinkRollWins(100, 0.9999)).toBe(true);
    expect(directLinkRollWins(1, 0.5)).toBe(false);
    expect(directLinkRollWins(50, 0.49)).toBe(true);
    expect(directLinkRollWins(50, 0.5)).toBe(false);
  });

  it("both spots call it, the config route serves it, and the read path normalizes it", () => {
    expect(code("features/wallpapers/wallpaper-reels.tsx")).toContain('useDirectLink("wallpaper")');
    // 2026-10-23: wrapped — the opener's first argument is now the outcome callback, never the click event
    expect(code("features/wallpapers/wallpaper-reels.tsx")).toContain("onClickCapture={() => openDirectLink()}");
    expect(code("features/downloader/preview-card.tsx")).toContain('useDirectLink("resultPreview")');
    expect(code("features/downloader/preview-card.tsx")).toContain("onClickCapture={() => openDirectLink()}");
    expect(code("features/wallpapers/wallpaper-reels.tsx")).not.toContain("onClickCapture={openDirectLink}");
    expect(code("features/downloader/preview-card.tsx")).not.toContain("onClickCapture={openDirectLink}");
    expect(code("app/api/ads/config/route.ts")).toContain("monetagDirectLink: publicDirectLink(settings.monetagDirectLink, settings.monetag === true)");
    expect(code("lib/monetization/settings.ts")).toContain("merged.monetagDirectLink = normalizeDirectLink(merged.monetagDirectLink)");
  });

  it("opens inside the tap (no await before window.open), from its own chunk, on every tap (no session lock)", () => {
    // 2026-10-19: it answers whether a link is set up (the ad close control falls back to closing), still synchronous
    expect(code("features/monetization/use-direct-link.ts")).toMatch(/return useCallback\(\(onOutcome\?: \(o: SpotOutcome\) => void\) => \{\s*if \(!opener\.current\) return false;\s*return opener\.current\(onOutcome\);\s*\}, \[\]\)/);
    const rt = code("features/monetization/direct-link-runtime.ts");
    const body = rt.slice(rt.indexOf("const openDirect = (): boolean => {"));
    expect(body).not.toMatch(/await|\.then\(/);
    // owner, 2026-10-16: "it should show everytime the selected area i told you is tapped"
    expect(body).not.toContain("sessionStorage");
    // Part 2.1: through the open observer, which opens it in a new tab (noopener) — lib/monetization/open-observer.ts
    expect(body).toContain("openOwnWindow(direct.url);");
    expect(code("lib/monetization/open-observer.ts")).toContain('window.open(url, "_blank", "noopener,noreferrer");');
  });

  it("Pro and Business never get it (owner, 2026-10-18) — the plain Free-only answer, no placement", () => {
    const hook = code("features/monetization/use-direct-link.ts");
    // useShowAds() with NO placement = ads only for Free. A placement would let
    // Pro through wherever planSeesAd lists it (Reels, Feed, the download result).
    expect(hook).toMatch(/useShowAds\(\)/);
    expect(hook).toContain("if (!spot || !ready || !showAds) return;");
    expect(planSeesAd("pro", null)).toBe(false);
    expect(planSeesAd("business", null)).toBe(false);
    expect(planSeesAd("free", null)).toBe(true);
    // teeth: the same check fails on a hook that passes a Pro placement
    expect("useShowAds(\"reels_interstitial\")").not.toMatch(/useShowAds\(\)/);
    expect(planSeesAd("pro", "reels_interstitial")).toBe(true);
  });

  it("teeth: a broken normalizer or a served link that ignores the Monetag switch fails", () => {
    const leaky = (raw: unknown, _monetagOn: boolean) => publicDirectLink(raw, true);
    expect(leaky({ enabled: true, url: OWNER_LINK }, false)).not.toBeNull();
    const naive = (raw: { enabled: unknown }) => ({ ...DEFAULT_DIRECT_LINK, enabled: Boolean(raw.enabled) });
    expect(naive({ enabled: "false" }).enabled).not.toBe(normalizeDirectLink({ enabled: "false" }).enabled);
  });
});
