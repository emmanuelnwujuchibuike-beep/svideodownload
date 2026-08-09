import { describe, expect, it } from "vitest";

import { DEFAULT_WALLPAPER_SORT, isWallpaperSort, sortWallpapers, WALLPAPER_SORTS } from "./wallpapers-sort";
import type { Wallpaper } from "./wallpapers";

/**
 * Wallpaper ordering (owner, 2026-08-09: "show wallpaper based on time uploaded
 * and users can change the sorting to most liked, most viewed, alphabetically
 * and any other sort").
 *
 * Sort comparators look obviously correct and are quietly wrong at the edges,
 * and none of those edges is visible by looking at a grid of pictures. These are
 * the edges.
 */

const wp = (over: Partial<Wallpaper> & { name: string }): Wallpaper => ({
  id: over.name,
  category: "Abstract",
  url: "u",
  thumbUrl: "t",
  downloadUrl: "d",
  likes: 0,
  saves: 0,
  comments: 0,
  views: 0,
  downloads: 0,
  width: null,
  height: null,
  createdAt: null,
  builtIn: false,
  ...over,
});

describe("the sort registry", () => {
  it("defaults to upload time", () => {
    expect(DEFAULT_WALLPAPER_SORT).toBe("newest");
  });

  it("offers the orderings the owner asked for", () => {
    const keys = WALLPAPER_SORTS.map((s) => s.key);
    expect(keys).toContain("newest");
    expect(keys).toContain("liked");
    expect(keys).toContain("viewed");
    expect(keys).toContain("az");
    // "any other sort"
    expect(keys).toContain("downloaded");
    expect(keys).toContain("saved");
    expect(keys).toContain("za");
    expect(keys).toContain("oldest");
  });

  it("gives every ordering a label and a hint", () => {
    for (const s of WALLPAPER_SORTS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length, `${s.key} has no hint`).toBeGreaterThan(0);
    }
  });

  it("validates a sort key from a URL or storage", () => {
    expect(isWallpaperSort("liked")).toBe(true);
    expect(isWallpaperSort("nonsense")).toBe(false);
    expect(isWallpaperSort(null)).toBe(false);
  });
});

describe("sortWallpapers", () => {
  it("never mutates the input", () => {
    // The gallery holds these in React state; sorting in place would produce a
    // render that does not match what the component believes it rendered.
    const items = [wp({ name: "B" }), wp({ name: "A" })];
    const before = items.map((i) => i.name);
    sortWallpapers(items, "az");
    expect(items.map((i) => i.name)).toEqual(before);
  });

  it("orders newest by real upload time, not by array order", () => {
    const items = [
      wp({ name: "old", createdAt: "2026-01-01T00:00:00Z" }),
      wp({ name: "new", createdAt: "2026-08-01T00:00:00Z" }),
      wp({ name: "mid", createdAt: "2026-05-01T00:00:00Z" }),
    ];
    expect(sortWallpapers(items, "newest").map((i) => i.name)).toEqual(["new", "mid", "old"]);
    expect(sortWallpapers(items, "oldest").map((i) => i.name)).toEqual(["old", "mid", "new"]);
  });

  it("sinks undated built-ins to the bottom in BOTH date directions", () => {
    /*
      The built-in placeholders ship with the code and were never uploaded.
      Treating a missing date as 0 would make them "the oldest uploads" under
      Oldest — they are not old, they are not uploads.
    */
    const items = [
      wp({ name: "builtin", createdAt: null, builtIn: true }),
      wp({ name: "real", createdAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(sortWallpapers(items, "newest").map((i) => i.name)).toEqual(["real", "builtin"]);
    expect(sortWallpapers(items, "oldest").map((i) => i.name)).toEqual(["real", "builtin"]);
  });

  it("survives an unparseable date without reordering everything", () => {
    const items = [wp({ name: "bad", createdAt: "not-a-date" }), wp({ name: "good", createdAt: "2026-01-01T00:00:00Z" })];
    expect(sortWallpapers(items, "newest").map((i) => i.name)).toEqual(["good", "bad"]);
  });

  it("ranks by each engagement metric independently", () => {
    const items = [
      wp({ name: "a", likes: 1, views: 9, downloads: 5, saves: 2 }),
      wp({ name: "b", likes: 9, views: 1, downloads: 2, saves: 5 }),
    ];
    expect(sortWallpapers(items, "liked")[0]!.name).toBe("b");
    expect(sortWallpapers(items, "viewed")[0]!.name).toBe("a");
    expect(sortWallpapers(items, "downloaded")[0]!.name).toBe("a");
    expect(sortWallpapers(items, "saved")[0]!.name).toBe("b");
  });

  it("breaks count ties by name, so the grid does not reshuffle between renders", () => {
    // A new library is full of zeroes — ties are the NORMAL case here, and an
    // unstable-looking shuffle reads as a bug even when the ranking is right.
    const items = [wp({ name: "Zebra" }), wp({ name: "Apple" }), wp({ name: "Mango" })];
    expect(sortWallpapers(items, "liked").map((i) => i.name)).toEqual(["Apple", "Mango", "Zebra"]);
    // Same input, same output, every time.
    expect(sortWallpapers(items, "liked").map((i) => i.name)).toEqual(
      sortWallpapers([...items].reverse(), "liked").map((i) => i.name),
    );
  });

  it("sorts alphabetically without dumping lowercase after uppercase", () => {
    // A plain `<` compares UTF-16 code units and puts "Zebra" before "apple".
    const items = [wp({ name: "Zebra" }), wp({ name: "apple" }), wp({ name: "Mango" })];
    expect(sortWallpapers(items, "az").map((i) => i.name)).toEqual(["apple", "Mango", "Zebra"]);
    expect(sortWallpapers(items, "za").map((i) => i.name)).toEqual(["Zebra", "Mango", "apple"]);
  });

  it("orders a numbered series the way a human numbers it", () => {
    // "Wallpaper 10" belongs after "Wallpaper 9", not before it.
    const items = [wp({ name: "Wallpaper 10" }), wp({ name: "Wallpaper 9" }), wp({ name: "Wallpaper 1" })];
    expect(sortWallpapers(items, "az").map((i) => i.name)).toEqual([
      "Wallpaper 1",
      "Wallpaper 9",
      "Wallpaper 10",
    ]);
  });

  it("keeps accented names beside their base letter", () => {
    const items = [wp({ name: "Zen" }), wp({ name: "Éclipse" }), wp({ name: "Aurora" })];
    expect(sortWallpapers(items, "az").map((i) => i.name)).toEqual(["Aurora", "Éclipse", "Zen"]);
  });

  it("handles an empty library", () => {
    for (const s of WALLPAPER_SORTS) expect(sortWallpapers([], s.key)).toEqual([]);
  });
});
