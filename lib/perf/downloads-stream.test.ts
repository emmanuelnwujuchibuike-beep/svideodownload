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
    /const wallpapers = listWallpapers\(user\.id\);/.test(data) &&
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
      "const [profile, landing, platformStatus, multiLink, aiPromo] = await Promise.all([",
      "const [profile, landing, platformStatus, multiLink, aiPromo, w] = await Promise.all([listWallpapers(user.id),",
    );
    expect(streamsWallpapers(page)).toBe(false);
  });
});
