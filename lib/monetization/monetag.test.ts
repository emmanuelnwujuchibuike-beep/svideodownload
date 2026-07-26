import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MONETAG_AD_TYPES,
  MONETAG_AD_TYPE_IDS,
  MONETAG_SURFACES,
  isMonetagAdType,
  isMonetagSurfaceId,
  monetagAllowedOnPath,
  parseMonetagSnippet,
  resolveMonetagSurface,
  resolveMonetagTags,
  type MonetagUnit,
} from "./monetag";
import { normalizeMonetagUnits } from "./settings";

/**
 * Monetag is site-level, self-placing script tags — so the risk here is the same
 * one `verificationTags` and the AdSense site script guard against: an admin
 * free-text field reaching `<head>`. Every test below pins that only a clean
 * https script URL is ever accepted, and that a single master switch silences the
 * whole network.
 */

const TAG = '<script src="//foo.monetag.com/tag.min.js" data-zone="1234567" data-cfasync="false"></script>';

describe("Monetag ad-type registry", () => {
  it("declares the dashboard's formats with unique ids + metadata", () => {
    const ids = MONETAG_AD_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of MONETAG_AD_TYPES) {
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(10);
    }
    // The five the owner's dashboard shows.
    for (const expected of ["multitag", "in_page_push", "push_notification", "vignette_banner", "onclick_popunder"]) {
      expect(ids).toContain(expected);
    }
    expect([...MONETAG_AD_TYPE_IDS].sort()).toEqual([...ids].sort());
  });

  it("fails closed on an unknown type", () => {
    expect(isMonetagAdType("multitag")).toBe(true);
    for (const bad of ["", "banner", "MULTITAG", null, undefined, 3]) {
      expect(isMonetagAdType(bad)).toBe(false);
    }
  });
});

describe("parseMonetagSnippet — only a clean https script tag", () => {
  it("extracts the https src, zone and cfAsync from a real tag", () => {
    const parsed = parseMonetagSnippet(TAG);
    expect(parsed).toEqual({
      src: "https://foo.monetag.com/tag.min.js",
      zone: "1234567",
      cfAsync: true,
    });
  });

  it("promotes a protocol-relative // src to https", () => {
    expect(parseMonetagSnippet('<script src="//x.com/a.js"></script>')?.src).toBe("https://x.com/a.js");
  });

  it("returns null for anything that isn't a clean https script URL", () => {
    for (const bad of [
      "",
      "   ",
      "<script>alert(1)</script>", // inline code, no src
      '<img src="x" onerror="alert(1)">', // markup, not a script src
      '<script src="http://insecure.com/a.js"></script>', // http, not https
      '<script src="javascript:alert(1)"></script>', // scheme injection
      'just some text data-zone="12"',
    ]) {
      expect(parseMonetagSnippet(bad), `${bad} should not parse`).toBeNull();
    }
  });

  it("never returns a non-https src", () => {
    // Property, not example: whatever parses, its src starts https://
    for (const s of [TAG, '<script src="//a.b/c.js" data-zone="9">', 'src="//d.e/f.js"']) {
      const p = parseMonetagSnippet(s);
      if (p) expect(p.src.startsWith("https://")).toBe(true);
    }
  });
});

describe("resolveMonetagTags — combine, validate, de-dup, gate", () => {
  const base = { monetag: true, monetagSnippet: "", monetagUnits: [] as MonetagUnit[] };

  it("returns nothing when the master switch is off", () => {
    expect(resolveMonetagTags({ ...base, monetag: false, monetagSnippet: TAG })).toEqual([]);
  });

  it("emits the Multitag from monetagSnippet, typed as multitag", () => {
    const tags = resolveMonetagTags({ ...base, monetagSnippet: TAG });
    expect(tags).toHaveLength(1);
    expect(tags[0]!.type).toBe("multitag");
    expect(tags[0]!.src).toBe("https://foo.monetag.com/tag.min.js");
  });

  it("emits one tag per configured unit and keeps their types", () => {
    const tags = resolveMonetagTags({
      ...base,
      monetagUnits: [
        { type: "in_page_push", snippet: '<script src="//a.com/1.js" data-zone="11"></script>' },
        { type: "onclick_popunder", snippet: '<script src="//b.com/2.js" data-zone="22"></script>' },
      ],
    });
    expect(tags.map((t) => t.type)).toEqual(["in_page_push", "onclick_popunder"]);
    expect(tags.map((t) => t.zone)).toEqual(["11", "22"]);
  });

  it("drops a unit whose snippet doesn't parse — never emits it blank", () => {
    const tags = resolveMonetagTags({
      ...base,
      monetagUnits: [
        { type: "push_notification", snippet: "not a tag" },
        { type: "vignette_banner", snippet: '<script src="//c.com/3.js" data-zone="33"></script>' },
      ],
    });
    expect(tags).toHaveLength(1);
    expect(tags[0]!.type).toBe("vignette_banner");
  });

  it("de-duplicates the same (src + zone) pasted twice", () => {
    const tags = resolveMonetagTags({
      ...base,
      monetagSnippet: TAG,
      monetagUnits: [{ type: "vignette_banner", snippet: TAG }],
    });
    expect(tags).toHaveLength(1); // the unit duplicate of the Multitag is dropped
  });

  it("ignores a unit with an unknown type", () => {
    const tags = resolveMonetagTags({
      ...base,
      monetagUnits: [{ type: "bogus" as MonetagUnit["type"], snippet: TAG }],
    });
    expect(tags).toEqual([]);
  });
});

describe("normalizeMonetagUnits — defend the stored row", () => {
  it("keeps well-formed units and drops the rest", () => {
    const clean = normalizeMonetagUnits([
      { type: "in_page_push", snippet: "x" },
      { type: "bogus", snippet: "y" }, // unknown type
      { type: "vignette_banner", snippet: 5 }, // non-string snippet
      null,
      "nope",
    ]);
    expect(clean).toEqual([{ type: "in_page_push", snippet: "x" }]);
  });

  it("returns [] for non-array input", () => {
    for (const bad of [null, undefined, {}, "x", 3]) {
      expect(normalizeMonetagUnits(bad)).toEqual([]);
    }
  });

  it("caps the number of units", () => {
    const many = Array.from({ length: 40 }, () => ({ type: "in_page_push", snippet: "x" }));
    expect(normalizeMonetagUnits(many).length).toBeLessThanOrEqual(20);
  });
});

describe("Monetag page scope — resolveMonetagSurface", () => {
  it("maps the clear surfaces", () => {
    expect(resolveMonetagSurface("/")).toBe("home");
    expect(resolveMonetagSurface("/blog")).toBe("content");
    expect(resolveMonetagSurface("/blog/how-to")).toBe("content");
    expect(resolveMonetagSurface("/academy")).toBe("content");
    expect(resolveMonetagSurface("/help/article")).toBe("content");
    expect(resolveMonetagSurface("/pricing")).toBe("info");
    expect(resolveMonetagSurface("/trust/x")).toBe("info");
    expect(resolveMonetagSurface("/home")).toBe("app");
    expect(resolveMonetagSurface("/messages/123")).toBe("app");
    expect(resolveMonetagSurface("/downloads")).toBe("app");
  });

  it("treats a top-level slug as a downloader/SEO page", () => {
    expect(resolveMonetagSurface("/tiktok-video-downloader")).toBe("downloader");
    expect(resolveMonetagSurface("/youtube")).toBe("downloader");
  });

  it("never shows on system/auth/operator pages", () => {
    for (const p of ["/admin", "/admin/whatever", "/login", "/auth/callback", "/api/ads", "/p/abc", "/u/emily", "/welcome"]) {
      expect(resolveMonetagSurface(p), `${p} must not be a Monetag surface`).toBeNull();
    }
  });

  it("every surface has an id, label and hint; ids are unique + valid", () => {
    const ids = MONETAG_SURFACES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of MONETAG_SURFACES) {
      expect(isMonetagSurfaceId(s.id)).toBe(true);
      expect(s.label.length).toBeGreaterThan(2);
      expect(s.hint.length).toBeGreaterThan(5);
    }
    expect(isMonetagSurfaceId("nope")).toBe(false);
  });
});

describe("Monetag page scope — monetagAllowedOnPath", () => {
  it("shows everywhere when allPages is true", () => {
    for (const p of ["/", "/tiktok", "/admin", "/home"]) {
      expect(monetagAllowedOnPath(p, { monetagAllPages: true, monetagSurfaces: [] })).toBe(true);
    }
  });

  it("shows only on the selected surfaces when allPages is false", () => {
    const scope = { monetagAllPages: false, monetagSurfaces: ["downloader", "home"] };
    expect(monetagAllowedOnPath("/", scope)).toBe(true); // home
    expect(monetagAllowedOnPath("/tiktok", scope)).toBe(true); // downloader
    expect(monetagAllowedOnPath("/blog", scope)).toBe(false); // content not selected
    expect(monetagAllowedOnPath("/home", scope)).toBe(false); // app not selected
  });

  it("nothing selected + not all pages = shows nowhere (fails closed)", () => {
    for (const p of ["/", "/tiktok", "/blog"]) {
      expect(monetagAllowedOnPath(p, { monetagAllPages: false, monetagSurfaces: [] })).toBe(false);
    }
  });

  it("a system page is never allowed even if all pages is on? (no — allPages wins)", () => {
    // allPages is a blunt override by design; the surface gate is the finer tool.
    expect(monetagAllowedOnPath("/admin", { monetagAllPages: true, monetagSurfaces: [] })).toBe(true);
    // …but under surface scope, /admin resolves to no surface, so it's excluded.
    expect(monetagAllowedOnPath("/admin", { monetagAllPages: false, monetagSurfaces: ["home", "downloader", "content", "info", "app"] })).toBe(false);
  });
});

describe("Monetag is plan-gated — Pro/Business are ad-free", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("injects the tags on the client, gated on the entitlements showAds signal", () => {
    /*
     * The bug this pins: the site-level Monetag script rendered in <head> for
     * EVERY visitor, so paying (Pro/Business) users — who are ad-free — got
     * Monetag's popunder/push/vignette anyway. The gate can't be server-side
     * without un-static-ing the marketing pages, so it lives on the client via
     * useEntitlements, exactly like every placed ad.
     */
    const src = read("features/monetization/monetag-tags.tsx");
    expect(src).toContain("useEntitlements");
    expect(src).toMatch(/showAds/);
    // Waits for the truth before injecting, so a premium user is never served in
    // the gap before /api/me answers.
    expect(src).toMatch(/!ready|ready &&/);
  });

  it("also gates by page — only injects on the owner's selected surfaces", () => {
    const src = read("features/monetization/monetag-tags.tsx");
    expect(src).toContain("usePathname");
    expect(src).toContain("monetagAllowedOnPath");
  });

  it("injects via a real script element with a validated src, never innerHTML", () => {
    const src = read("features/monetization/monetag-tags.tsx");
    expect(src).toContain('createElement("script")');
    expect(src).toMatch(/\.src\s*=\s*tag\.src/);
    // The whole point of parse-never-inject: no markup sink reaches the client.
    expect(src).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
  });

  it("the server component renders no raw <script> — it delegates to the gated client", () => {
    const src = read("features/monetization/monetag-script.tsx");
    expect(src).toContain("MonetagTags");
    expect(src, "MonetagScript must not server-render a <script> (that bypasses the plan gate)").not.toMatch(
      /<script\b/,
    );
  });
});
