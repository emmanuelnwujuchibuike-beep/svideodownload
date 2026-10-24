import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// owner, 2026-10-24: an Upgrade-to-Pro banner with the Pro price under the result card's Download button, one line only
const banner = readFileSync("features/monetization/result-pro-banner.tsx", "utf8");
const card = readFileSync("features/downloader/preview-card.tsx", "utf8");

describe("the result card's Pro banner", () => {
  it("sits on the result card AFTER the Download button", () => {
    const button = card.indexOf('data-ad-spot="download"');
    const placed = card.indexOf("<ResultProBanner");
    expect(button).toBeGreaterThan(0);
    expect(placed).toBeGreaterThan(button);
  });
  it("is free-visitors-only and reads the admin's Pro price, not a hardcoded one", () => {
    expect(banner).toContain("useShowAds()");
    expect(banner).toContain('fetch("/api/pricing")');
    expect(banner).not.toMatch(/\$\d/);
  });
  it("one line, no feature list, and no claim Pro doesn't keep (Pro still sees the result-page ad)", () => {
    expect(banner).not.toMatch(/<ul|<li|PRO_HIGHLIGHTS/);
    expect(banner).toContain("No ads before your downloads, so files come faster — plus more across the app.");
    expect(banner).not.toMatch(/>[^<]*\b(100% )?ad-free\b/i);
  });
});
