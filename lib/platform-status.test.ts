import { describe, expect, it } from "vitest";

import {
  degradedPlatforms,
  DEFAULT_PLATFORM_STATUS,
  isPlatformStatus,
  normalizePlatformStatus,
  PLATFORM_STATUS_META,
  statusOf,
} from "./platform-status";

/**
 * This badge makes a public claim about somebody else's service on every page it
 * appears. The failures worth pinning are the ones where it claims the WRONG
 * thing — and the worst of those is painting a working platform red because a
 * settings read hiccuped.
 */

describe("statusOf — fail OPEN", () => {
  it("🔴 defaults to operational for an unset platform", () => {
    // Silence must read as "nothing to report", not "broken". Defaulting to
    // `down` would tell every visitor the product is broken the first time the
    // settings table is unreachable.
    expect(statusOf({}, "tiktok")).toBe("operational");
    expect(statusOf(null, "tiktok")).toBe("operational");
    expect(statusOf(undefined, "youtube")).toBe("operational");
  });

  it("defaults to operational for a corrupted entry", () => {
    const junk = { tiktok: { status: "exploded", updatedAt: "x" } } as never;
    expect(statusOf(junk, "tiktok")).toBe(DEFAULT_PLATFORM_STATUS);
  });

  it("returns what was actually set", () => {
    const map = {
      tiktok: { status: "down" as const, updatedAt: "2026-08-11T00:00:00Z" },
      youtube: { status: "partial" as const, updatedAt: "2026-08-11T00:00:00Z" },
    };
    expect(statusOf(map, "tiktok")).toBe("down");
    expect(statusOf(map, "youtube")).toBe("partial");
    expect(statusOf(map, "instagram")).toBe("operational");
  });
});

describe("normalizePlatformStatus — the stored value is untrusted", () => {
  it("drops entries with an invalid status", () => {
    // 🔴 A bad status string reaching a Record lookup renders `undefined` as a
    // className, which is a badge with no colour at all.
    const out = normalizePlatformStatus({
      tiktok: { status: "down", updatedAt: "2026-08-11T00:00:00Z" },
      youtube: { status: "kinda", updatedAt: "2026-08-11T00:00:00Z" },
    });
    expect(Object.keys(out)).toEqual(["tiktok"]);
  });

  it("survives every shape of junk", () => {
    for (const v of [null, undefined, 0, "", "down", [], { tiktok: null }, { tiktok: 5 }]) {
      expect(() => normalizePlatformStatus(v)).not.toThrow();
    }
    expect(normalizePlatformStatus(null)).toEqual({});
    expect(normalizePlatformStatus({ tiktok: 5 })).toEqual({});
  });

  it("supplies a timestamp when one is missing, so 'last changed' is never blank", () => {
    const out = normalizePlatformStatus({ tiktok: { status: "partial" } });
    expect(typeof out.tiktok?.updatedAt).toBe("string");
  });

  it("trims and caps the operator note", () => {
    const out = normalizePlatformStatus({
      tiktok: { status: "partial", updatedAt: "x", note: "  4K failing  " },
    });
    expect(out.tiktok?.note).toBe("4K failing");

    const long = normalizePlatformStatus({
      tiktok: { status: "partial", updatedAt: "x", note: "z".repeat(500) },
    });
    expect(long.tiktok?.note?.length).toBe(140);
  });

  it("drops an empty note rather than storing an empty string", () => {
    const out = normalizePlatformStatus({ tiktok: { status: "down", updatedAt: "x", note: "   " } });
    expect(out.tiktok).not.toHaveProperty("note");
  });
});

describe("presentation metadata", () => {
  it("has a complete, non-empty entry for every status", () => {
    // The badge reads its colour AND its accessible label from here, so a
    // missing key is an unlabelled dot — meaningless to a screen reader.
    for (const s of ["operational", "partial", "down"] as const) {
      const m = PLATFORM_STATUS_META[s];
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.short.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.dot).toMatch(/^bg-/);
    }
  });

  it("uses three DIFFERENT colours", () => {
    const dots = new Set(Object.values(PLATFORM_STATUS_META).map((m) => m.dot));
    expect(dots.size).toBe(3);
  });
});

describe("degradedPlatforms", () => {
  it("lists only what is not fully working", () => {
    const map = {
      tiktok: { status: "down" as const, updatedAt: "x" },
      youtube: { status: "partial" as const, updatedAt: "x" },
      instagram: { status: "operational" as const, updatedAt: "x" },
    };
    expect(degradedPlatforms(map).sort()).toEqual(["tiktok", "youtube"]);
  });

  it("is empty when everything is fine", () => {
    expect(degradedPlatforms({})).toEqual([]);
  });
});

describe("isPlatformStatus", () => {
  it("accepts only the three real values", () => {
    expect(isPlatformStatus("operational")).toBe(true);
    expect(isPlatformStatus("partial")).toBe(true);
    expect(isPlatformStatus("down")).toBe(true);
    for (const v of ["OPERATIONAL", "up", "", null, 1, {}]) expect(isPlatformStatus(v)).toBe(false);
  });
});
