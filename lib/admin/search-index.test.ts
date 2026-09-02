import { describe, expect, it } from "vitest";

import { ADMIN_SETTING_ENTRIES, searchAdmin } from "@/lib/admin/search-index";
import { ADMIN_SECTIONS } from "@/lib/admin/sections";

describe("🔴 every indexed entry points somewhere real", () => {
  /*
    The one property that matters. A search result leading to a section that
    does not exist costs the operator the hunt AND their trust in the box —
    worse than returning nothing at all.
  */
  const sectionIds = new Set(ADMIN_SECTIONS.map((s) => s.id));

  it.each(ADMIN_SETTING_ENTRIES.map((e) => [e.id, e.section] as const))(
    "%s -> section %s exists",
    (_id, section) => {
      expect(sectionIds.has(section)).toBe(true);
    },
  );

  it("has no duplicate entry ids", () => {
    const ids = ADMIN_SETTING_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a hint saying where to look", () => {
    for (const e of ADMIN_SETTING_ENTRIES) {
      expect(e.hint.length, e.id).toBeGreaterThan(3);
      expect(e.keywords.length, e.id).toBeGreaterThan(0);
    }
  });
});

describe("searchAdmin — the searches an operator actually types", () => {
  /*
    Owner, 2026-09-02: "how do i turn of enableon download ? i cant find it".

    The control existed; the search did not. Each of these is a phrasing
    somebody would plausibly use for that same switch, and all of them must
    reach it.
  */
  it.each([
    "enabledOnDownload",
    "download start",
    "start ad",
    "turn off ad",
  ])("%s finds the download-start ad switch", (q) => {
    const ids = searchAdmin(q).map((r) => r.id);
    expect(ids).toContain("vast.enabledOnDownload");
  });

  it("finds the completion ad separately from the start ad", () => {
    const ids = searchAdmin("download complete").map((r) => r.id);
    expect(ids).toContain("vast.enabledOnDownloadComplete");
  });

  it.each([
    ["hilltop", "hilltop"],
    ["adsense", "adsense"],
    ["popunder", "popunder"],
    ["cpm", "cpm"],
    ["skip", "vast.skipAfterSeconds"],
    ["cooldown", "vast.cooldownMs"],
    ["price", "pricing"],
    ["feature flag", "flags"],
  ])("%s finds %s", (q, expected) => {
    expect(searchAdmin(q).map((r) => r.id)).toContain(expected);
  });

  it("finds sections by their own name too", () => {
    const ids = searchAdmin("moderation").map((r) => r.id);
    expect(ids.some((i) => i === "section:moderation" || i === "moderation")).toBe(true);
  });

  it("ranks a specific control above the section containing it", () => {
    // Somebody typing a precise phrase wants the switch, not the screen.
    const results = searchAdmin("download start");
    expect(results[0]?.kind).toBe("setting");
  });

  it("returns nothing for a query too short to mean anything", () => {
    expect(searchAdmin("")).toEqual([]);
    expect(searchAdmin("a")).toEqual([]);
  });

  it("returns nothing rather than guessing for an unrelated query", () => {
    expect(searchAdmin("zzzznotathing")).toEqual([]);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(searchAdmin("EnabledOnDownload").length).toBeGreaterThan(0);
    expect(searchAdmin("pop-under").map((r) => r.id)).toContain("popunder");
  });

  it("respects the result limit", () => {
    expect(searchAdmin("a", 3).length).toBeLessThanOrEqual(3);
    expect(searchAdmin("ad", 3).length).toBeLessThanOrEqual(3);
  });
});
