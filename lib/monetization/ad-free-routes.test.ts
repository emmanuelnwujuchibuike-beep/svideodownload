import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isAdFreeRoute } from "./ad-free-routes";
import { monetagAllowedOnPath } from "./monetag";

/** Owner, 2026-10-14: "ad shouldn't show in the sign in page or profile page". */
const code = (f: string) => readFileSync(path.resolve(process.cwd(), f), "utf8");

describe("ad-free routes", () => {
  it("sign-in and every profile page are ad-free; ordinary pages are not", () => {
    for (const p of ["/login", "/login/mfa-challenge", "/login?next=/home", "/signup", "/welcome", "/u/kpn", "/u/kpn/card", "/profile"]) expect(isAdFreeRoute(p), p).toBe(true);
    for (const p of ["/", "/home", "/feed", "/reels", "/downloads", "/history", "/user-guide", "/loginhelp"]) expect(isAdFreeRoute(p), p).toBe(false);
  });

  it("🔴 Monetag is refused there even when the admin turned it on for every page", () => {
    expect(monetagAllowedOnPath("/u/kpn", { monetagAllPages: true, monetagSurfaces: [] })).toBe(false);
    expect(monetagAllowedOnPath("/login", { monetagAllPages: true, monetagSurfaces: [] })).toBe(false);
    expect(monetagAllowedOnPath("/feed", { monetagAllPages: true, monetagSurfaces: [] })).toBe(true);
  });

  it("every app-wide ad surface asks it first", () => {
    expect(code("features/monetization/use-show-ads.ts")).toContain("if (isAdFreeRoute(pathname)) return { showAds: false, ready };");
    expect(code("features/monetization/app-bottom-ad.tsx")).toContain("return isAdFreeRoute(pathname) ||");
    expect(code("features/monetization/vast-interstitial/request.ts")).toContain("isAdFreeRoute(window.location.pathname)) return { shown: false");
  });
});

describe("closing a sheet over the reel viewer keeps the viewer's lock", () => {
  it("🔴 the sheet saves and restores overflowY, never the overflow shorthand", () => {
    const s = code("features/ui/glass-sheet-shell.tsx");
    expect(s).toContain("const prevOverflowY = document.body.style.overflowY;");
    expect(s).toContain("document.body.style.overflowY = prevOverflowY;");
    expect(s).not.toMatch(/document\.body\.style\.overflow = /);
  });
});
