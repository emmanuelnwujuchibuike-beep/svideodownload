import { describe, expect, it } from "vitest";

import { fallbackBackHref } from "./back-fallback";

describe("fallbackBackHref — back with nothing behind this document", () => {
  it.each([
    ["/messages/abc", "/messages"],
    ["/messages/new/user1", "/messages"],
    ["/messages", "/messages"],
    ["/u/frenz", "/home"],
    ["/u/frenz/followers", "/u/frenz"],
    ["/u/frenz/following/", "/u/frenz"],
    ["/account", "/home"],
    ["/account/security", "/account"],
    ["/ai", "/home"],
    ["/ai/character-replace", "/ai"],
    ["/ai/history", "/ai"],
    ["/studio", "/home"],
    ["/studio/ai", "/studio"],
    ["/studio/ai/character-replace", "/studio/ai"],
    ["/p/123", "/feed"],
    ["/reels", "/feed"],
    ["/downloads", "/home"],
    ["/downloads/x", "/downloads"],
    ["/home", "/home"],
    ["/", "/home"],
    ["/notifications", "/home"],
    ["/friends/requests", "/friends"],
  ])("%s → %s", (from, to) => {
    expect(fallbackBackHref(from)).toBe(to);
  });
});
