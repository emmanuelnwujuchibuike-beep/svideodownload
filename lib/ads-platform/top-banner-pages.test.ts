import { describe, expect, it } from "vitest";

import { topBannerAllowed } from "./top-banner-pages";

/** The global top banner's pages (owner, 2026-10-22) — every rule with a case that fails on a bad fixture. */
describe("where the global top banner shows", () => {
  it("🔴 never on the social pages, signed in or not", () => {
    for (const p of ["/home", "/reels", "/reels/abc", "/exclusive", "/exclusive/favourites", "/friends", "/messages/123", "/explore", "/notifications", "/chris_doe", "/u/abc"]) {
      expect(topBannerAllowed(p, true), `${p} member`).toBe(false);
      expect(topBannerAllowed(p, false), `${p} guest`).toBe(false);
    }
  });

  it("a signed-out visitor sees it everywhere else", () => {
    for (const p of ["/", "/earn", "/quests", "/support", "/help", "/history", "/wallpapers", "/tiktok-downloader"]) expect(topBannerAllowed(p, false), p).toBe(true);
  });

  it("a signed-in member only on Earn, Quests and Support", () => {
    for (const p of ["/earn", "/quests", "/quests/today", "/support"]) expect(topBannerAllowed(p, true), p).toBe(true);
    for (const p of ["/", "/history", "/wallpapers", "/help", "/account"]) expect(topBannerAllowed(p, true), p).toBe(false);
  });

  it("teeth: Downloads has its own top slot, so the global bar never doubles it", () => {
    expect(topBannerAllowed("/downloads", true)).toBe(false);
    expect(topBannerAllowed("/downloads", false)).toBe(false);
  });

  it("teeth: a prefix is a path segment, not a string start", () => {
    // "/earnings" is not "/earn", "/homework" is not "/home"
    expect(topBannerAllowed("/earnings", true)).toBe(false);
    expect(topBannerAllowed("/homework-help", false)).toBe(true);
  });
});
