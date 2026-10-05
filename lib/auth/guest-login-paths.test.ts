import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { GUEST_LOGIN_PREFIXES, guestMustLogin } from "@/lib/auth/guest-login-paths";

/**
 * The edge redirect for guests must match the pages EXACTLY, in both
 * directions:
 *   - a listed path whose page does NOT always send guests to /login would
 *     block guest content (a real regression, not a cost saving);
 *   - a page that always sends guests to /login but is NOT listed (or under
 *     middleware's `needsGuard`) is a full server render thrown away for every
 *     guest who reaches it.
 */

const APP = join(process.cwd(), "app");
/** Prefixes middleware already guards via `needsGuard`. */
const NEEDS_GUARD = ["/account", "/ai", "/studio", "/admin"];
const UNCONDITIONAL = /^\s*if \(!user\) redirect\("\/login/m;

/** Every page.tsx with its URL path (route groups stripped). */
function pages(): { url: string; src: string }[] {
  return (readdirSync(APP, { recursive: true }) as string[])
    .filter((f) => /(^|[\\/])page\.tsx$/.test(f))
    .map((f) => {
      const url =
        "/" +
        relative(APP, join(APP, f))
          .replace(/\\/g, "/")
          .replace(/(^|\/)page\.tsx$/, "")
          .split("/")
          .filter((seg) => seg && !/^\(.*\)$/.test(seg))
          .join("/");
      return { url: url === "/" ? "/" : url.replace(/\/$/, ""), src: readFileSync(join(APP, f), "utf8") };
    });
}

function underNeedsGuard(url: string): boolean {
  return NEEDS_GUARD.some((p) => url === p || url.startsWith(`${p}/`));
}

describe("guest /login redirect at the edge", () => {
  const all = pages();

  it("finds the pages (the guard is not vacuous)", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((p) => p.url === "/downloads")).toBe(true);
  });

  it("every listed path is a page that ALWAYS sends a guest to /login — no guest content is blocked", () => {
    for (const prefix of GUEST_LOGIN_PREFIXES) {
      const covered = all.filter((p) => guestMustLogin(p.url));
      expect(covered.length, `${prefix} has no page`).toBeGreaterThan(0);
      for (const p of covered) {
        expect(UNCONDITIONAL.test(p.src), `${p.url} renders for guests — it must not be redirected at the edge`).toBe(true);
      }
    }
  });

  it("every page that always sends a guest to /login is answered at the edge", () => {
    const missing = all
      .filter((p) => UNCONDITIONAL.test(p.src))
      .filter((p) => !underNeedsGuard(p.url) && !guestMustLogin(p.url))
      .map((p) => p.url);
    expect(missing).toEqual([]);
  });

  it("prefix matching is by segment, never by string", () => {
    expect(guestMustLogin("/friends")).toBe(true);
    expect(guestMustLogin("/friends/discover")).toBe(true);
    expect(guestMustLogin("/friendship-guide")).toBe(false);
    expect(guestMustLogin("/downloadsx")).toBe(false);
    expect(guestMustLogin("/feed")).toBe(false);
    expect(guestMustLogin("/")).toBe(false);
  });
});
