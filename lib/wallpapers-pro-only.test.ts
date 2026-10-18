import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planCanDownloadProWallpaper, wallpaperIsProOnly } from "./wallpapers-limits";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("admin-uploaded wallpapers download on Pro and above only (owner, 2026-10-18)", () => {
  it("admin uploads (and the column default) are Pro-only; member shares are not", () => {
    expect(wallpaperIsProOnly("admin")).toBe(true);
    expect(wallpaperIsProOnly(null)).toBe(true);
    expect(wallpaperIsProOnly("member")).toBe(false);
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
    expect(server).toContain("proOnly: wallpaperIsProOnly(row.source)");
    expect(server).toContain('.select("title, image_url, source")');
  });

  it("a Free member in the reels viewer goes to the offer, never through a reward ad first", () => {
    const reels = code("features/wallpapers/wallpaper-reels.tsx");
    expect(reels).toContain("planReady && !isPremium ? setUpgradeOpen(true) : setPendingDownload(current)");
  });

  it("teeth: a gate that treats every plan alike, or the default as a member upload, fails", () => {
    const leaky = (_plan: "free" | "pro" | "business") => true;
    expect(leaky("free")).not.toBe(planCanDownloadProWallpaper("free"));
    const naive = (s: string | null) => s === "admin";
    expect(naive(null)).not.toBe(wallpaperIsProOnly(null));
  });
});
