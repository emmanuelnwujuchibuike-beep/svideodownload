import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planCanDownloadProWallpaper, WALLPAPER_PRO_ONLY_MESSAGE, wallpaperIsProOnly } from "./wallpapers-limits";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("4K wallpapers download on Pro and above only; below 4K is free (owner, 2026-10-31)", () => {
  it("4K — portrait or landscape — is Pro; below 4K and unmeasured are free", () => {
    expect(wallpaperIsProOnly(2160, 3840)).toBe(true);
    expect(wallpaperIsProOnly(3840, 2160)).toBe(true);
    expect(wallpaperIsProOnly(1440, 2560)).toBe(false);
    expect(wallpaperIsProOnly(1080, 1920)).toBe(false);
    expect(wallpaperIsProOnly(null, null)).toBe(false);
  });

  it("the offer says 4K is not free and to upgrade to Pro for it", () => {
    expect(WALLPAPER_PRO_ONLY_MESSAGE).toMatch(/4K wallpapers are not free/);
    expect(WALLPAPER_PRO_ONLY_MESSAGE).toMatch(/Upgrade to Pro for 4K wallpapers/);
    expect(code("features/wallpapers/wallpaper-reels.tsx")).toContain("{fourK ? WALLPAPER_PRO_ONLY_MESSAGE");
  });

  it("Pro and Business may download them; Free may not", () => {
    expect(planCanDownloadProWallpaper("pro")).toBe(true);
    expect(planCanDownloadProWallpaper("business")).toBe(true);
    expect(planCanDownloadProWallpaper("free")).toBe(false);
  });

  it("the server refuses BEFORE spending the allowance, and never edge-caches a Pro download", () => {
    const route = code("app/api/wallpaper/route.ts");
    const gate = route.indexOf("proOnly && !planCanDownloadProWallpaper(plan)");
    const spend = route.indexOf("await consumeDaily(");
    expect(gate).toBeGreaterThan(-1);
    expect(spend).toBeGreaterThan(gate);
    expect(route).toContain('code: "PRO_REQUIRED"');
    expect(route).toContain('isDownload && proOnly ? "private, no-store" : IMMUTABLE');
    // the row is resolved before the gate, so the gate knows it is Pro-only
    expect(route.indexOf("proOnly = found.proOnly")).toBeLessThan(route.indexOf("enforceWallpaperAllowance(request, downloadId, id, proOnly)"));
  });

  it("the row mapping and the image lookup both carry the flag", () => {
    const server = code("lib/wallpapers-server.ts");
    expect(server).toContain("proOnly: wallpaperIsProOnly(row.width, row.height)");
    expect(server).toContain('.select("title, image_url, width, height")');
  });

  it("a Free member in the reels viewer goes to the offer, never through a reward ad first", () => {
    const reels = code("features/wallpapers/wallpaper-reels.tsx");
    expect(reels).toContain("planReady && !isPremium ? setUpgrade4k(true) : setPendingDownload(current)");
  });

  it("teeth: a gate that treats every plan alike, or reads only the width, fails", () => {
    const leaky = (_plan: "free" | "pro" | "business") => true;
    expect(leaky("free")).not.toBe(planCanDownloadProWallpaper("free"));
    const widthOnly = (w: number, _h: number) => w >= 3840;
    expect(widthOnly(2160, 3840)).not.toBe(wallpaperIsProOnly(2160, 3840));
  });
});
