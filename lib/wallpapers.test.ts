import { describe, expect, it } from "vitest";

import { popularity, resolutionBadge, wallpaperType, WALLPAPER_TYPES } from "./wallpapers";

describe("resolutionBadge", () => {
  it("reads the LONG edge, so a portrait phone wallpaper is not downgraded", () => {
    // The library is almost entirely portrait. Testing width alone would call
    // this "HD" and mislabel nearly every wallpaper on the site.
    expect(resolutionBadge(2160, 3840)).toEqual({ short: "4K", long: "Ultra HD" });
    expect(resolutionBadge(3840, 2160)).toEqual({ short: "4K", long: "Ultra HD" });
  });

  it("uses the display standards as its thresholds", () => {
    expect(resolutionBadge(1440, 2560)).toEqual({ short: "2K", long: "Quad HD" });
    expect(resolutionBadge(1080, 1920)).toEqual({ short: "HD", long: "Full HD" });
  });

  it("shows NOTHING below Full HD rather than an unflattering label", () => {
    expect(resolutionBadge(720, 1280)).toBeNull();
  });

  it("shows nothing when the size was never measured", () => {
    // The whole point of the badge: an unmeasured row must not get a free 4K.
    expect(resolutionBadge(null, null)).toBeNull();
    expect(resolutionBadge(undefined, 3840)).toBeNull();
    expect(resolutionBadge(0, 0)).toBeNull();
    expect(resolutionBadge(-10, 3840)).toBeNull();
  });
});

describe("wallpaperType", () => {
  it("sorts by orientation", () => {
    expect(wallpaperType(1080, 1920)).toBe("phone");
    expect(wallpaperType(3840, 2160)).toBe("desktop");
    expect(wallpaperType(1080, 1080)).toBe("square");
  });

  it("treats near-square as square", () => {
    // 1200x1150 and 1080x1080 are the same thing to anyone choosing one.
    expect(wallpaperType(1200, 1150)).toBe("square");
    expect(wallpaperType(1150, 1200)).toBe("square");
  });

  it("is null when unmeasured, so it can be excluded rather than guessed", () => {
    expect(wallpaperType(null, null)).toBeNull();
    expect(wallpaperType(1080, 0)).toBeNull();
  });

  it("every id the filter offers is a value this can return", () => {
    const ids = WALLPAPER_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["phone", "desktop", "square"]));
  });
});

describe("popularity", () => {
  const base = { likes: 0, saves: 0, comments: 0, views: 0, downloads: 0 };

  it("ranks a download above a like", () => {
    expect(popularity({ ...base, downloads: 1 })).toBeGreaterThan(popularity({ ...base, likes: 1 }));
  });

  it("ranks a save above a like", () => {
    expect(popularity({ ...base, saves: 1 })).toBeGreaterThan(popularity({ ...base, likes: 1 }));
  });

  it("does not let views alone outrank real engagement", () => {
    // Views are the weakest signal — they mostly measure scroll position, which
    // is exactly what this ordering must not reward. Capped so a runaway view
    // count can never bury a wallpaper people actually saved.
    const viewed = popularity({ ...base, views: 1_000_000 });
    const saved = popularity({ ...base, saves: 200 });
    expect(saved).toBeGreaterThan(viewed);
  });

  it("is zero for a wallpaper nobody has touched", () => {
    expect(popularity(base)).toBe(0);
  });
});
