import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-31: "this floating NAV in Wallpaper page sometimes doesn't stay fixed when scrolling". The back /
  search / upload buttons were `absolute` inside the featured header, so they scrolled away with the picture.
*/
const src = readFileSync("features/wallpapers/wallpaper-explore.tsx", "utf8");

const staysFixed = (s: string) =>
  /className="pointer-events-none fixed inset-x-4 z-40 flex items-center justify-between" style=\{\{ top: "calc\(var\(--frenz-safe-top, 0px\) \+ 14px\)" \}\}/.test(s) &&
  // over the white sheet the Feed's frosted glass with ink icons, over the picture the see-through white
  /onSheet \? FROSTED_GLASS : GLASS_OVER_IMAGE/.test(s) &&
  /new IntersectionObserver\(\(\[e\]\) => setOnSheet\(!!e && !e\.isIntersecting\)/.test(s) &&
  // no live blur on the fixed bar (a fixed bar over a scrolling page re-blurs every frame)
  !/const GLASS_OVER_IMAGE = "[^"]*backdrop-blur/.test(s);

describe("the Wallpaper page's floating buttons stay put", () => {
  it("are fixed, change glass over the sheet, and never blur live", () => {
    expect(staysFixed(src)).toBe(true);
  });
  it("teeth: back inside the header (absolute), or a blurred fixed bar, fails", () => {
    expect(staysFixed(src.replace("pointer-events-none fixed inset-x-4 z-40", "absolute inset-x-4"))).toBe(false);
    expect(staysFixed(src.replace('const GLASS_OVER_IMAGE = "border', 'const GLASS_OVER_IMAGE = "backdrop-blur-xl border'))).toBe(false);
  });
});
