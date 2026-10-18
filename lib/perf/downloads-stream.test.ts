import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A member's landing is /downloads, rendered on every entry. Its slowest read —
 * the wallpaper library (three round trips) — must not hold the page back.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function streamsWallpapers(page: string): boolean {
  const data = page.slice(page.indexOf("async function DownloadsData"));
  return (
    // 2026-10-18: only the Wallpapers card's 10 photos are read (the in-page gallery is gone)
    /const wallpapers = listWallpapers\(null, 10\);/.test(data) &&
    !/await[^;]*listWallpapers/.test(data) &&
    !/Promise\.all\(\[[^\]]*listWallpapers/.test(data)
  );
}

describe("/downloads streams the wallpaper library instead of waiting for it", () => {
  it("the page starts the read and hands the promise down", () => {
    expect(streamsWallpapers(code("app/(app)/downloads/page.tsx"))).toBe(true);
    expect(code("features/downloads/downloads-page.tsx")).toContain("wallpapers: Wallpaper[] | Promise<Wallpaper[]>;");
  });
  it("teeth: awaiting it inside the Promise.all again fails", () => {
    const page = code("app/(app)/downloads/page.tsx").replace(
      "const [profile, platformStatus, multiLink, aiPromo] = await Promise.all([",
      "const [profile, platformStatus, multiLink, aiPromo, w] = await Promise.all([listWallpapers(null, 10),",
    );
    expect(streamsWallpapers(page)).toBe(false);
  });
});
