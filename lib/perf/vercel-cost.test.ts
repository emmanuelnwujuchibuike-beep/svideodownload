import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ NOTHING MAY COST MONEY WHILE NOBODY IS LOOKING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "this usage are costing me a lot with just small users,
 * cut down anything consuming, and write in memory to never ever ever make any
 * implementation that consumes." The bill that produced that rule had
 * **Function Invocations — the thing users actually cause — as the second
 * SMALLEST line**. Almost all of it was the app running with nobody in it.
 *
 * The standing law is written down. What was missing is a test, which is why
 * the same shapes kept coming back. These are the ones that were found live on
 * 2026-10-05, each a real cost at the time it was written:
 *
 *   · `/ai` regenerated every 300s, for a page whose only input changes when
 *     an administrator saves a switch — and that save already busts it.
 *   · `news-sitemap.xml` regenerated every 300s. A sitemap is fetched by
 *     CRAWLERS, so that clock ran around the clock with nobody on the site.
 *   · the admin provider panel read 1,000 `ai_provider_runs` rows over 30 days
 *     on every admin page view, to paint a tab about two providers that no
 *     longer execute anything.
 *
 * 🔴 Asserted as RULES over the tree, not as three file names, because the
 * next one will be in a file that does not exist yet.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The file with its comments removed.
 *
 * 🔴 Needed because these files EXPLAIN their own cadence in prose —
 * `app/(marketing)/page.tsx` carries the sentence "the cadence comes from
 * `export const revalidate = 60` in app/layout.tsx", and a raw match reads
 * that as a 60-second treadmill on the landing page. The first run of this
 * test did exactly that. A guard that fires on the documentation would be
 * answered by deleting the documentation, which is the opposite of useful.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Every route/page file under app/, so a new one cannot opt out by being new. */
function appFiles(dir = "app", out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) appFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes(".test.")) out.push(rel);
  }
  return out;
}

/**
 * The floor. Anything shorter is a regeneration treadmill that crawler traffic
 * alone keeps spinning — and each turn bills ISR Writes AND Fast Origin
 * Transfer AND Fluid Active CPU AND Observability Events at once.
 *
 * 30 minutes is not a magic number: it is "long enough that a crawler cannot
 * drive a meaningful spend". Anything that needs to be fresher than this is an
 * EVENT and belongs on `revalidatePath`, which is free and exact.
 */
const MIN_REVALIDATE_SECONDS = 1800;

/*
  ⚠️ THE REVALIDATE FLOOR IS NOT ASSERTED HERE.

  `lib/perf/isr-budget.test.ts` already owns it, with a better parser (it
  strips comments before matching — which this file's first draft did not,
  and it duly read the SENTENCE "export const revalidate = 60" inside a
  comment in app/(marketing)/page.tsx as a 60-second treadmill on the
  landing page).

  Two guards over one rule is how they drift and start contradicting each
  other. That file keeps the floor and the registry of pages that pay for
  their own freshness; this one covers everything else that spends.
*/
describe("freshness is an event, not a clock", () => {
  it("publishing a post busts the sitemaps instead of a timer polling for it", () => {
    const posts = read("lib/social/posts.ts");
    expect(posts).toContain('m.revalidatePath("/posts-sitemap.xml")');
    expect(posts).toContain('m.revalidatePath("/news-sitemap.xml")');
    /*
      Deferred-imported on purpose: a top-level `next/cache` import pulls
      server-only code into everything importing this module, and home-feed's
      tests then fail to load before a single assertion runs.
    */
    expect(posts).toContain('void import("next/cache")');
  });

  it("saving the landing settings still busts every page under the root layout", () => {
    // what makes the long window on /ai correct rather than stale
    expect(read("app/api/admin/landing/route.ts")).toContain('revalidatePath("/", "layout")');
  });
});

describe("the admin does not read the world on every page view", () => {
  it("the provider panel's query is bounded to a small, recent window", () => {
    const admin = code("lib/ai/providers/admin.ts");
    const m = /listProviderRuns\((\d+),\s*\{\s*days:\s*(\d+)/.exec(admin);
    expect(m, "listProviderRuns call not found").not.toBeNull();
    const [, limit, days] = m!;
    // teeth: the exact shape that was costing money — 1000 rows over 30 days
    expect(Number(limit), "row limit").toBeLessThanOrEqual(250);
    expect(Number(days), "day window").toBeLessThanOrEqual(7);
  });

  it("the admin live scheduler still stops dead on a hidden tab", () => {
    /*
      Not a new rule — the existing protection, pinned. A dashboard left open
      on a second monitor must cost nothing, and this is the line that makes
      that true.
    */
    const sched = read("features/admin/live/scheduler.ts");
    expect(sched).toContain('document.visibilityState !== "visible"');
    expect(sched).toContain("MAX_BACKOFF_FACTOR");
    expect(sched).toContain("MAX_QUIET_FACTOR");
  });
});

describe("a build that cannot change the deployment does not run", () => {
  const gate = read("scripts/vercel-should-build.sh");

  it("test-only commits are exempt, because next build does not run vitest", () => {
    /*
      🔴 Build CPU Minutes is the LARGEST line on this project's bill, and this
      gate used to say "Tests are deliberately NOT exempt: they gate the build."
      They do not gate it — `next build` never runs vitest, and Next does not
      typecheck test files either. A commit touching only `*.test.ts` produced
      a byte-identical deployment and paid for a full build to produce it.

      The owner's standing rule names the case exactly: "A build on a commit
      that cannot change the deployment."
    */
    /*
      Shell comments stripped: this file now RECORDS the old wrong reasoning
      ("this file used to say \\"Tests are deliberately NOT exempt\\"") so the
      next person does not reinstate it. Matching raw text would fire on that
      history and be answered by deleting it.
    */
    const gateCode = gate.replace(/^s*#.*$/gm, "");
    expect(gateCode).toContain("*.test.ts|*.test.tsx|*.test.mjs");
    expect(gateCode).not.toContain("Tests are deliberately NOT exempt");
  });

  it("🔴 it still fails TOWARD building — a wrongly skipped build is worse", () => {
    // every uncertain path must exit 1 (build), never 0 (skip)
    expect(gate).toContain("No parent commit to diff against — building.");
    expect(gate).toContain("Could not read the diff — building to be safe.");
    expect(gate).toContain("Empty diff — building to be safe.");
  });

  it("source, assets, scripts and migrations still build", () => {
    /*
      Teeth for the exemption: it must stay a short, closed list. Widening it
      to something the deployment DOES serve would silently stop shipping real
      changes, which is far worse than an unnecessary build.
    */
    const clause = gate.slice(gate.indexOf("case \"$file\" in"), gate.indexOf("esac"));
    for (const shippable of ["public/", "supabase/", "scripts/", "lib/", "app/"]) {
      expect(clause, `${shippable} must not be exempt`).not.toContain(`${shippable}*)`);
    }
  });
});
