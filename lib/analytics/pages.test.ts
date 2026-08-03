import { describe, expect, it } from "vitest";

import { matchPage, PAGE_GROUPS, PAGES, pageSpec } from "@/lib/analytics/pages";

describe("page registry", () => {
  it("has unique ids", () => {
    const ids = PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every page matches its own sample path", () => {
    for (const p of PAGES) {
      expect(matchPage(p.sample), `${p.id} does not match its own sample ${p.sample}`).toBe(p.id);
    }
  });

  it("no two pages claim the same exact path", () => {
    const seen = new Map<string, string>();
    for (const p of PAGES) {
      for (const e of p.exact ?? []) {
        expect(seen.has(e), `${e} is claimed by both ${seen.get(e)} and ${p.id}`).toBe(false);
        seen.set(e, p.id);
      }
    }
  });

  it("every page belongs to a rendered group", () => {
    for (const p of PAGES) {
      expect(PAGE_GROUPS, `${p.id} is in group ${p.group}, which the dashboard never renders`).toContain(p.group);
    }
  });

  it("exposes the spec for every id", () => {
    for (const p of PAGES) expect(pageSpec(p.id)).toBeDefined();
  });
});

describe("matchPage", () => {
  it("tracks the wallpapers page (the reason this registry exists)", () => {
    expect(matchPage("/wallpapers")).toBe("wallpapers");
    expect(matchPage("/wallpapers?reels=1")).toBe("wallpapers");
  });

  it("keeps a settings sub-page out of the settings root row", () => {
    expect(matchPage("/account")).toBe("settings");
    expect(matchPage("/account/privacy")).toBe("settings-detail");
    expect(matchPage("/account/identity/bio")).toBe("settings-detail");
  });

  it("collapses dynamic routes into one row", () => {
    expect(matchPage("/u/ada")).toBe("profile-public");
    expect(matchPage("/u/ada/followers")).toBe("profile-public");
    expect(matchPage("/p/abc")).toBe("post");
    expect(matchPage("/messages/17")).toBe("messages");
  });

  it("ignores query strings, fragments and a trailing slash", () => {
    expect(matchPage("/features?utm_source=x")).toBe("features");
    expect(matchPage("/features#top")).toBe("features");
    expect(matchPage("/features/")).toBe("features");
    expect(matchPage("/")).toBe("home");
  });

  it("returns null for an uncatalogued path so it lands in Other, not the void", () => {
    expect(matchPage("/something-nobody-catalogued")).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(matchPage(null)).toBeNull();
    expect(matchPage(undefined)).toBeNull();
    expect(matchPage("")).toBeNull();
    expect(matchPage("not-a-path")).toBeNull();
  });
});
