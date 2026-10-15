import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mayCarryUpdate } from "./deferred-update";

/** Owner, 2026-10-15: "Make everything open instant, never reload on every entry or backswipe". */
const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, over: Partial<{ target: string; hasDownload: boolean }> = {}) => ({ href, target: "", hasDownload: false, ...over });
const here = { origin: "https://frenzsave.com", pathname: "/home", search: "" };

describe("which tap may carry a waiting deploy", () => {
  it("a plain tap on an in-app link does", () => {
    expect(mayCarryUpdate(click, link("https://frenzsave.com/history"), here)).toBe(true);
    expect(mayCarryUpdate(click, link("/reels"), here)).toBe(true);
  });

  it("a new tab, a modified click, a download, another site or an in-page anchor never does", () => {
    expect(mayCarryUpdate({ ...click, metaKey: true }, link("/history"), here)).toBe(false);
    expect(mayCarryUpdate({ ...click, button: 1 }, link("/history"), here)).toBe(false);
    expect(mayCarryUpdate(click, link("/history", { target: "_blank" }), here)).toBe(false);
    expect(mayCarryUpdate(click, link("/file.mp4", { hasDownload: true }), here)).toBe(false);
    expect(mayCarryUpdate(click, link("https://tiktok.com/@x"), here)).toBe(false);
    expect(mayCarryUpdate(click, link("/home#comments"), here)).toBe(false);
    expect(mayCarryUpdate({ ...click, defaultPrevented: true }, link("/history"), here)).toBe(false);
  });

  it("never on the way into or out of sign-in (a one-time code must not be re-used)", () => {
    expect(mayCarryUpdate(click, link("/login?next=/home"), here)).toBe(false);
    expect(mayCarryUpdate(click, link("/home"), { ...here, pathname: "/auth/callback" })).toBe(false);
  });
});

describe("the deploy check never reloads on entry, resume or back-swipe", () => {
  const src = readFileSync("features/notifications/register-sw.tsx", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("finding a new build only remembers it; the next in-app tap loads its destination", () => {
    expect(code).not.toMatch(/location\.reload\(/);
    expect(code).toContain("pendingBuild = build;");
    expect(code).toContain('document.addEventListener("click", onDocumentClick, true);');
    expect(code).toContain("window.location.assign(a.href);");
  });

  it("teeth: the old reload-on-detection shape is caught", () => {
    const old = `if (build && build !== BAKED_APP_BUILD) { localStorage.setItem(RELOADED_KEY, build); window.location.reload(); }`;
    expect(old).toMatch(/location\.reload\(/);
  });
});
