import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimableProducts,
  findFalseExistenceClaims,
  findMagnitudeClaims,
  staleVeracity,
  unclaimableProducts,
} from "./reality-ledger";
import { getModules } from "@/lib/platform/modules";

/**
 * The Reality Ledger gate. See `docs/LIVING_CONTENT_PLATFORM_RFC.md` §3.
 *
 * This file exists because both of the failures it prevents have ALREADY shipped:
 *
 *   1. Products marketed that were never built. The landing spec described 25
 *      products; 16 did not exist. `Frenz Studio` and `Frenzsave Cloud` still
 *      have no route, and `Frenzsave Smart` was carrying `status: "beta"` while its
 *      only UI surface sat commented out in `app/layout.tsx`.
 *
 *   2. Fabricated magnitude on the front door. `components/landing/stats-counter.tsx`
 *      hardcoded 35,000,000+ "Videos Downloaded" and 8,000,000+ "Community Members"
 *      and animated them on scroll so they read as live telemetry. Measured against
 *      the database on 2026-07-18, both were overstated by four to five orders of
 *      magnitude.
 *
 * The second is not a taste issue — it is a factual claim about the business,
 * presented as measured, on the page most visitors see first. That is an
 * advertising-claims exposure, and it contradicts this project's own twice-declined
 * "no fake engagement" rule.
 *
 * If a test here fails, the fix is to correct the copy or source the number.
 * Do NOT add `@sourced` to silence it unless you can state where the figure came
 * from — that marker is a claim of provenance, and review reads it as one.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Surfaces a prospective user reads before signing up. */
const MARKETING_DIRS = ["components/landing", "app/(marketing)", "config"];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return []; // directory renamed — covered by the sanity test below
  }
  return entries.flatMap((e) => {
    const rel = path.join(dir, e);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e) && !e.endsWith(".test.ts") ? [rel] : [];
  });
}

const MARKETING_FILES = MARKETING_DIRS.flatMap(walk);

describe("Reality Ledger — genome integrity", () => {
  it("scans a non-empty set of marketing files", () => {
    // Guards the whole suite: if the dirs move, every test below passes vacuously.
    expect(MARKETING_FILES.length).toBeGreaterThan(5);
  });

  it("every module declares a veracity record", () => {
    for (const m of getModules()) {
      expect(m.veracity, `${m.id} has no veracity record`).toBeDefined();
      expect(typeof m.veracity.claimable, `${m.id}.claimable`).toBe("boolean");
    }
  });

  it("every claimable product names a proving route", () => {
    // A claim with nothing to point at is the exact failure this field prevents.
    for (const m of claimableProducts()) {
      expect(m.veracity.provingRoute, `${m.name} is claimable but proves nothing`).toBeTruthy();
    }
  });

  it("every claimable product's proving route exists on disk", () => {
    for (const m of claimableProducts()) {
      const route = m.veracity.provingRoute!;
      const found = ["app/(app)", "app/(marketing)", "app", "app/api"].some((base) => {
        try {
          return statSync(path.join(ROOT, base, route.replace(/^\//, ""))).isDirectory();
        } catch {
          return false;
        }
      });
      expect(found, `${m.name} claims ${route}, which has no route directory`).toBe(true);
    }
  });

  it("a product may not be claimable while staged as unbuilt", () => {
    for (const m of claimableProducts()) {
      expect(
        ["live", "beta", "alpha"],
        `${m.name} is claimable but staged "${m.veracity.stage}"`,
      ).toContain(m.veracity.stage);
    }
  });

  it("flags veracity records no human has re-confirmed in 90 days", () => {
    // Advisory, not fatal — drift is a review-queue item, not a build break.
    const stale = staleVeracity(90);
    if (stale.length) {
      console.warn(
        `[reality-ledger] re-verify: ${stale.map((m) => m.id).join(", ")}`,
      );
    }
    expect(Array.isArray(stale)).toBe(true);
  });
});

describe("Reality Ledger — the detector itself", () => {
  /*
   * A gate that passes because it can no longer see anything is worse than no gate:
   * it reports safety it isn't providing. These pin the detector's teeth against the
   * exact strings that shipped, and against the noise that made the first cut unusable.
   */

  it("catches the fabricated stats that actually shipped", () => {
    const shipped = `
      { icon: Download, label: "Videos Downloaded", target: 35_000_000 },
      { icon: Users, label: "Community Members", target: 8_000_000 },
    `;
    expect(findMagnitudeClaims("x.tsx", shipped).length).toBeGreaterThanOrEqual(2);
  });

  it("catches a percentage claim and a bare '20+ Platforms' heading", () => {
    expect(findMagnitudeClaims("x.tsx", `<p>99.9% success rate</p>`)).toHaveLength(1);
    expect(findMagnitudeClaims("x.tsx", `<h2>Download from 20+ Platforms</h2>`)).toHaveLength(1);
  });

  it("ignores the interior lines of a multi-line JSX comment", () => {
    // A comment documenting a removed claim must not itself be flagged. Line-local
    // detection cannot see this: the middle line carries no comment marker.
    const src = ['{/*', '  Was "Join Millions Using Frenz" — removed.', '*/}'].join("\n");
    expect(findMagnitudeClaims("x.tsx", src)).toHaveLength(0);
  });

  it("still catches a claim on the line after a block comment closes", () => {
    const src = ["/* explanatory note */", "<p>Join millions of people</p>"].join("\n");
    expect(findMagnitudeClaims("x.tsx", src)).toHaveLength(1);
  });

  it("catches worded magnitudes with no companion noun", () => {
    // "Join Millions Using Frenz" has no social-proof noun ("Using", not "users").
    expect(findMagnitudeClaims("x.tsx", `<h2>Join Millions Using Frenz</h2>`)).toHaveLength(1);
  });

  it("ignores CSS colours, Tailwind arbitrary values and comments", () => {
    expect(findMagnitudeClaims("x.tsx", `shadow-[0_0_0_1px_rgba(255,255,255,0.35)] users`)).toHaveLength(0);
    expect(findMagnitudeClaims("x.tsx", `// we used to claim 8,000,000 members`)).toHaveLength(0);
    expect(findMagnitudeClaims("x.tsx", ` * 35,000,000+ videos downloaded`)).toHaveLength(0);
  });

  it("ignores plan quotas, which are specs rather than social proof", () => {
    expect(findMagnitudeClaims("x.tsx", `"10,000 downloads/day"`)).toHaveLength(0);
    expect(findMagnitudeClaims("x.tsx", `Business 10,000 requests per day`)).toHaveLength(0);
  });

  it("honours @sourced on the claim line and the line above", () => {
    expect(findMagnitudeClaims("x.tsx", `const users = 5_000_000; // @sourced db`)).toHaveLength(0);
    expect(findMagnitudeClaims("x.tsx", `// @sourced db\nconst users = 5_000_000;`)).toHaveLength(0);
  });

  it("catches present-tense copy for an unbuilt product", () => {
    const copy = `<p>Frenz Studio lets you trim and remix every clip.</p>`;
    const hits = findFalseExistenceClaims("x.tsx", copy);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.product).toBe("Frenz Studio");
  });

  it("permits future-tense copy for the same product", () => {
    expect(findFalseExistenceClaims("x.tsx", `<p>Frenz Studio is coming soon.</p>`)).toHaveLength(0);
  });
});

describe("Reality Ledger — marketing copy", () => {
  it("states no unsourced magnitude on any marketing surface", () => {
    const claims = MARKETING_FILES.flatMap((f) =>
      findMagnitudeClaims(f, readFileSync(path.join(ROOT, f), "utf8")),
    );
    const report = claims.map((c) => `  ${c.file}:${c.line}  "${c.text}"  ${c.snippet}`).join("\n");
    expect(claims, `Unsourced magnitude claims:\n${report}`).toHaveLength(0);
  });

  it("never presents an unbuilt product as existing", () => {
    const claims = MARKETING_FILES.flatMap((f) =>
      findFalseExistenceClaims(f, readFileSync(path.join(ROOT, f), "utf8")),
    );
    const report = claims.map((c) => `  ${c.file}:${c.line}  ${c.product}: ${c.snippet}`).join("\n");
    expect(claims, `Copy claims an unbuilt product exists:\n${report}`).toHaveLength(0);
  });

  it("keeps unbuilt products out of the claimable set", () => {
    // Pins today's truth so re-marking one as claimable is a deliberate, reviewed act.
    expect(unclaimableProducts().map((m) => m.id).sort()).toEqual(
      ["admin", "cloud", "smart", "studio"].sort(),
    );
  });
});
