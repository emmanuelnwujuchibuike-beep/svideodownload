import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const moments = readFileSync("features/ads-platform/serve/self-moments.tsx", "utf8");
const dl = readFileSync("features/wallpapers/use-wallpaper-download.ts", "utf8");

// Owner, 2026-10-31: a free wallpaper download's completion shows the Download page's full-screen self ad — shared.
function shared(m: string, d: string): boolean {
  return (
    // wallpaper downloads run through the manager, which sends the completion
    /startDownload\(\{/.test(d) &&
    // on the wallpaper pages that completion is served as the Download page's moment
    m.includes("const onWallpapers = /^\\/wallpapers(\\/|$)/.test(where.current.pathname);") &&
    m.includes('pick("download_completed_interstitial", "download-complete", onWallpapers ? { page: "download" } : {})')
  );
}

describe("the download-complete self ad is shared with wallpapers", () => {
  it("holds", () => {
    expect(shared(moments, dl)).toBe(true);
  });
  it("has teeth", () => {
    expect(shared(moments.replace('onWallpapers ? { page: "download" } : {}', "{}"), dl)).toBe(false);
    expect(shared(moments, dl.replace("startDownload({", "fetchDirect({"))).toBe(false);
  });
});
