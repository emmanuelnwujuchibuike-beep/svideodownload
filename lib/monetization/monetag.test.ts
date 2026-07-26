import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MONETAG_AD_TYPES,
  MONETAG_AD_TYPE_IDS,
  MONETAG_MOMENT_EVENTS,
  MONETAG_PLACEMENTS,
  MONETAG_SURFACES,
  isMonetagAdType,
  isMonetagPlacementId,
  isMonetagSurfaceId,
  monetagAllowedOnPath,
  parseMonetagSnippet,
  resolveMonetagPlacements,
  resolveMonetagSurface,
  resolveMonetagTags,
  type MonetagPlacement,
  type MonetagUnit,
} from "./monetag";
import { normalizeMonetagPlacements, normalizeMonetagUnits } from "./settings";

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

  it("carries the zone from Monetag's INLINE loader (the 'valid tag but no ad' bug)", () => {
    // The exact shapes from the owner's per-type tags. The inline form sets the
    // zone via `s.dataset.zone`, NOT a data-zone attribute — dropping it made the
    // script load with no zone, so Monetag served nothing.
    const inPagePush =
      "<script>(function(s){s.dataset.zone='11414359',s.src='https://nap5k.com/tag.min.js'})([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')))</script>";
    const vignette =
      "<script>(function(s){s.dataset.zone='11414431',s.src='https://n6wxm.com/vignette.min.js'})</script>";

    expect(parseMonetagSnippet(inPagePush)).toEqual({
      src: "https://nap5k.com/tag.min.js",
      zone: "11414359",
      cfAsync: false,
    });
    expect(parseMonetagSnippet(vignette)).toEqual({
      src: "https://n6wxm.com/vignette.min.js",
      zone: "11414431",
      cfAsync: false,
    });
  });

  it("accepts a tag whose zone rides in the src query (?z=…)", () => {
    // Push Notifications tag: zone is in the URL, not a data-zone attribute.
    const push = '<script src="https://5gvci.com/act/files/tag.min.js?z=11414717" data-cfasync="false" async></script>';
    const parsed = parseMonetagSnippet(push);
    expect(parsed?.src).toBe("https://5gvci.com/act/files/tag.min.js?z=11414717");
    expect(parsed?.cfAsync).toBe(true);
    // zone stays null because it's carried in the URL — the re-emitted src keeps it.
    expect(parsed?.zone).toBeNull();
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

describe("Monetag moment placements", () => {
  const TAG = '<script src="//p.monetag.com/t.js" data-zone="99"></script>';

  it("declares the moments the owner asked for, with unique valid ids", () => {
    const ids = MONETAG_PLACEMENTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const expected of ["download_complete", "rewarded", "interstitial", "idle", "return", "backswipe"]) {
      expect(ids).toContain(expected);
      expect(isMonetagPlacementId(expected)).toBe(true);
    }
    expect(isMonetagPlacementId("nope")).toBe(false);
  });

  it("resolves one parsed tag per configured moment, gated on the master switch", () => {
    const input = {
      monetag: true,
      monetagPlacements: [
        { moment: "download_complete", snippet: TAG },
        { moment: "backswipe", snippet: '<script src="//x.co/y.js" data-zone="7"></script>' },
      ] as MonetagPlacement[],
    };
    const resolved = resolveMonetagPlacements(input);
    expect(resolved.map((r) => r.moment)).toEqual(["download_complete", "backswipe"]);
    expect(resolved[0]!.src).toBe("https://p.monetag.com/t.js");
    // master off → nothing
    expect(resolveMonetagPlacements({ ...input, monetag: false })).toEqual([]);
  });

  it("drops an invalid snippet and an unknown moment", () => {
    const resolved = resolveMonetagPlacements({
      monetag: true,
      monetagPlacements: [
        { moment: "idle", snippet: "not a tag" }, // invalid → dropped
        { moment: "bogus" as MonetagPlacement["moment"], snippet: TAG }, // unknown → dropped
        { moment: "return", snippet: TAG }, // valid → kept
      ],
    });
    expect(resolved.map((r) => r.moment)).toEqual(["return"]);
  });

  it("keeps one tag per moment — a valid duplicate is de-duped (first wins)", () => {
    const resolved = resolveMonetagPlacements({
      monetag: true,
      monetagPlacements: [
        { moment: "return", snippet: TAG },
        { moment: "return", snippet: '<script src="//other.co/z.js" data-zone="2"></script>' },
      ],
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.src).toBe("https://p.monetag.com/t.js");
  });

  it("the flow-moment event names are shared constants (dispatcher can't drift)", () => {
    expect(MONETAG_MOMENT_EVENTS.download_complete).toBe("frenz:monetag:download-complete");
    expect(MONETAG_MOMENT_EVENTS.rewarded).toBe("frenz:monetag:rewarded");
  });
});

describe("normalizeMonetagPlacements — one per moment, defend the row", () => {
  it("keeps well-formed, drops bad, dedupes by moment, caps snippet length", () => {
    const clean = normalizeMonetagPlacements([
      { moment: "idle", snippet: "a" },
      { moment: "idle", snippet: "b" }, // dup moment
      { moment: "bogus", snippet: "c" },
      { moment: "return", snippet: 5 },
      null,
    ]);
    expect(clean).toEqual([{ moment: "idle", snippet: "a" }]);
    expect(normalizeMonetagPlacements("x")).toEqual([]);
  });
});

describe("the placement trigger engine wires each moment", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const src = readFileSync(path.join(ROOT, "features/monetization/monetag-placements.tsx"), "utf8");

  it("owns the browser moments and listens for the flow moments", () => {
    expect(src).toContain("popstate"); // back-swipe
    expect(src).toContain("visibilitychange"); // return / idle
    expect(src).toContain("usePathname"); // interstitial on nav
    expect(src).toContain("MONETAG_MOMENT_EVENTS"); // download_complete + rewarded
  });

  it("gates on plan + page scope before loading anything", () => {
    expect(src).toContain("useEntitlements");
    expect(src).toContain("monetagAllowedOnPath");
  });

  it("the download + reward overlays dispatch the flow-moment events", () => {
    const dl = readFileSync(path.join(ROOT, "features/monetization/download-complete-ad.tsx"), "utf8");
    const rw = readFileSync(path.join(ROOT, "features/monetization/rewarded-ad.tsx"), "utf8");
    expect(dl).toContain("MONETAG_MOMENT_EVENTS.download_complete");
    expect(rw).toContain("MONETAG_MOMENT_EVENTS.rewarded");
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
    expect(src).toContain("MonetagClient");
    expect(src, "MonetagScript must not server-render a <script> (that bypasses the plan gate)").not.toMatch(
      /<script\b/,
    );
  });
});
