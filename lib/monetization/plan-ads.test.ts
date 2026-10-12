import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { planSeesAd, PRO_AD_PLACEMENTS } from "./plan-ads";

describe("which ads a plan sees (owner 2026-10-12)", () => {
  it("free sees every ad", () => {
    for (const z of ["top_banner", "bottom_banner", "feed_inline", "under_download", undefined]) expect(planSeesAd("free", z)).toBe(true);
  });
  it("business sees none — not even the ones Pro keeps", () => {
    for (const z of [...PRO_AD_PLACEMENTS, "top_banner", undefined]) expect(planSeesAd("business", z)).toBe(false);
  });
  it("pro keeps the download result, History, Feed and Reels ads", () => {
    for (const z of ["download_result_page", "download_complete", "download_history_top", "download_history_bottom", "history_grid", "history", "feed_inline", "reels_interstitial"]) expect(planSeesAd("pro", z), z).toBe(true);
  });
  it("pro loses every other ad, and an unnamed one", () => {
    for (const z of ["top_banner", "bottom_banner", "downloads_top", "under_download", "sticky", "landing", "bottomnav", "ai_hub_card", undefined, null]) expect(planSeesAd("pro", z), String(z)).toBe(false);
  });
  it("the shipped pattern and the readable list agree", () => {
    for (const z of PRO_AD_PLACEMENTS) expect(planSeesAd("pro", z), z).toBe(true);
    for (const z of ["history_gridx", "xhistory", "download_history", "feed_inline2"]) expect(planSeesAd("pro", z), z).toBe(false);
  });
  it("the hook and the server route both go through planSeesAd", () => {
    expect(readFileSync("features/monetization/use-show-ads.ts", "utf8")).toContain("planSeesAd(");
    expect(readFileSync("app/api/ads/route.ts", "utf8")).toContain("planSeesAd(");
  });
});
