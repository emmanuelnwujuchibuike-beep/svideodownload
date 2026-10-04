import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE ISR CLOCK IS A RATCHET, AND IT ONLY GOES UP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The bill that produced this test (2026-10-04, 14 days still left in the
 * cycle, $20 of included credit already gone):
 *
 *     Observability Events  $6.20      ISR Writes            $2.71
 *     Fast Origin Transfer  $5.04      Provisioned Memory    $2.68
 *     Fluid Active CPU      $4.76      Function Invocations  $1.13
 *
 * `Function Invocations` — what visitors actually cause — was the second
 * smallest line. Nearly all of it was `export const revalidate = 60` on the
 * ROOT LAYOUT.
 *
 * Next uses the LOWEST `revalidate` in a route's tree, so one number on
 * `app/layout.tsx` governs every static page under it. At 60 seconds, any
 * request — a crawler's, at 3am — made the page re-render on the server and
 * rewrite its cache entry within the minute, and each turn bills four lines at
 * once: the write, the origin→edge transfer of the fresh payload, the CPU of
 * the render, and the observability events of the invocation. Across the
 * landing, 39 SEO pages, academy, blog, help, learn, topics and trust, that is
 * a site regenerating itself around the clock for nobody.
 *
 * Freshness is an EVENT here, not a clock: the admin save already calls
 * `revalidatePath("/", "layout")`, which drops the whole tree at once.
 *
 * So this file guards the thing that is expensive to get wrong and easy to
 * change back without noticing.
 */

/** Below this, the root clock is regenerating the whole catalogue for nobody. */
const MIN_ROOT_REVALIDATE_SECONDS = 3600;

function revalidateOf(path: string): number | null {
  const code = src(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const m = /export\s+const\s+revalidate\s*=\s*([0-9_]+)/.exec(code);
  return m ? Number(m[1]!.replace(/_/g, "")) : null;
}

describe("the root ISR clock", () => {
  it("is long enough that an idle site costs nothing", () => {
    const seconds = revalidateOf("app/layout.tsx");
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThanOrEqual(MIN_ROOT_REVALIDATE_SECONDS);
  });

  /*
    🔴 TEETH. The assertion above passes on a file with no `revalidate` at all,
    and it would have passed on a parser that cannot read the old value. This
    proves the reader finds a real number and that the old one fails the rule.
  */
  it("rejects the value that actually produced the bill", () => {
    const parse = (code: string) => {
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const m = /export\s+const\s+revalidate\s*=\s*([0-9_]+)/.exec(stripped);
      return m ? Number(m[1]!.replace(/_/g, "")) : null;
    };
    expect(parse("export const revalidate = 60;")).toBe(60);
    expect(parse("export const revalidate = 60;")! >= MIN_ROOT_REVALIDATE_SECONDS).toBe(false);
    // and a commented-out value is not mistaken for a live one
    expect(parse("/* export const revalidate = 60; */")).toBeNull();
  });

  /*
    A page MAY be fresher than the root — it then pays for itself alone rather
    than billing the whole catalogue. This records which ones have chosen to,
    so adding another is a deliberate line in a diff rather than a silent cost.
  */
  it("has no page quietly undercutting it", () => {
    const shorter: Record<string, number> = {
      // the AI front door: 5 minutes, one page
      "app/(marketing)/ai/page.tsx": 300,
      // a news sitemap is worthless if it is stale; it is also tiny
      "app/news-sitemap.xml/route.ts": 300,
      "app/posts-sitemap.xml/route.ts": 3600,
    };
    for (const [path, expected] of Object.entries(shorter)) {
      expect(`${path}=${revalidateOf(path)}`).toBe(`${path}=${expected}`);
    }
  });

  /*
    The clock is only safe to be long because the admin save invalidates the
    whole tree. If that call loses its "layout" scope, a save stops reaching the
    SEO pages and the long clock becomes a day of staleness instead of seconds.
  */
  it("keeps the on-demand invalidation that replaced the clock", () => {
    for (const path of ["app/api/admin/landing/route.ts", "app/api/admin/platform-status/route.ts"]) {
      expect(`${path} :: ${/revalidatePath\(\s*"\/"\s*,\s*"layout"\s*\)/.test(src(path))}`).toBe(`${path} :: true`);
    }
  });
});
