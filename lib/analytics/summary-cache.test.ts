import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments stripped, so prose ABOUT a rule cannot satisfy a test of the rule. */
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const QUERIES = "lib/analytics/queries.ts";

/**
 * The admin dashboard's two expensive 90-day reads are cached.
 *
 * Owner, 2026-09-27: "all the data in admin dashboard takes time to load after
 * the admin dashboard opens."
 *
 * Measured against production, after the covering index in 0177:
 *   analytics_traffic_totals   4,109 ms
 *   analytics_timeseries       1,996 ms
 *   analytics_download_totals  1,504 ms
 *
 * — recomputed on every page open, for figures describing three months.
 *
 * Every assertion here pins something that would silently undo itself: a cache
 * that is removed, a TTL that drifts long enough to lie about live visitors, or
 * a failed read being stored and shown to everyone for two minutes.
 */
describe("the admin analytics summary is cached", () => {
  it("reads through the shared cache, not the database, on every call", () => {
    const body = code(QUERIES);
    expect(body).toMatch(/import \{ getCached \} from "@\/lib\/cache"/);
    expect(body).toMatch(/getCached\(\s*`admin:analytics-summary:\$\{range\}`/);
    expect(body).toMatch(/getCached\(\s*`admin:visitor-split:\$\{days\}`/);
  });

  it("keeps the uncached computation reachable only through the cached door", () => {
    const body = code(QUERIES);
    // The expensive work moved behind a private name. If a future edit exports
    // it or calls it directly, the cache stops being the only path in.
    expect(body).toMatch(/async function computeAnalyticsSummary\(/);
    expect(body).not.toMatch(/export async function computeAnalyticsSummary\(/);
    expect(body).toMatch(/async function computeVisitorSplitSeries\(/);
    expect(body).not.toMatch(/export async function computeVisitorSplitSeries\(/);
  });

  it("never caches a summary whose aggregates are not exact", () => {
    /*
      🔴 THE TRAP THIS EXISTS FOR. `getCached` stores whatever the loader
      RESOLVES with, and this loader resolves with a zero-filled summary
      carrying `exactAggregates: false` instead of throwing. Cache that once and
      every admin sees "figures could not be read" for the full TTL because of a
      single unlucky timeout — turning a one-off into a two-minute outage.

      So the failure case is thrown, caught, and returned UNCACHED.
    */
    const body = code(QUERIES);
    expect(body).toMatch(/if \(!summary\.rpcHealth\.exactAggregates\) throw new UncacheableSummary\(summary\)/);
    expect(body).toMatch(/if \(err instanceof UncacheableSummary\) return err\.summary/);
  });

  it("holds the TTL at two minutes or less, because one field is live", () => {
    /*
      `liveVisitors` means "active in the last five minutes". Two minutes of
      staleness on a five-minute window is visible but honest; a longer cache
      would report people who had already left. Every other field in here is an
      aggregate over months and would tolerate far more.
    */
    const m = code(QUERIES).match(/const SUMMARY_TTL_SECONDS = (\d+);/);
    expect(m, "SUMMARY_TTL_SECONDS is gone").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1]), "a longer TTL would let liveVisitors report people who left").toBeLessThanOrEqual(120);
  });
});

describe("the admin skeletons are visible against the page", () => {
  /*
    🔴 `bg-card` IS WHITE on the light theme. Three placeholders were pulsing
    white on white — including one static box shared by all nine lazy AI admin
    tabs — which is indistinguishable from a section that failed to load, and is
    exactly how it was reported ("it shows white").
  */
  const files = [
    "app/admin/page.tsx",
    "features/admin/frenz-ai-settings-lazy.tsx",
    "features/admin/signed-in-users-lazy.tsx",
  ];

  it("uses a contrasting ground for every pulsing placeholder", () => {
    for (const f of files) {
      const body = code(f);
      for (const line of body.split("\n")) {
        if (!line.includes("animate-pulse")) continue;
        expect(
          /bg-secondary/.test(line),
          `${f}: a pulsing placeholder on \`bg-card\` is white on white:\n  ${line.trim()}`,
        ).toBe(true);
      }
    }
  });

  it("gives the lazy admin panels something that moves", () => {
    // A static box says nothing. Motion is the only signal that separates
    // "arriving" from "broken" while a chunk or a query is in flight.
    for (const f of ["features/admin/frenz-ai-settings-lazy.tsx", "features/admin/signed-in-users-lazy.tsx"]) {
      expect(code(f), `${f} has no animated skeleton`).toMatch(/animate-pulse/);
    }
  });
});

describe("the member modal obeys the portal law", () => {
  const modal = code("features/admin/signed-in-users.tsx");

  it("renders through the portal, not as a bare fixed overlay", () => {
    /*
      🔴 FOURTH HIT OF A STANDING LAW. `position: fixed` does NOT resolve
      against the viewport when an ancestor carries `transform`, `filter`,
      `backdrop-filter` or `will-change`. `AdminPanel` renders its section with
      `motion-safe:animate-fade-up`, which animates a transform — so a bare
      `fixed inset-0` modal was pinned to that panel's box: the site header
      stayed visible, the page kept its own scroll, and the panel's full height
      showed as blank space below the card.

      Removing the offending ancestor is NOT the fix: the next transform
      anywhere above re-introduces it silently, on a component nobody touched.
    */
    expect(modal).toMatch(/<Portal>/);
    expect(modal).toMatch(/import \{ Portal \} from "@\/components\/ui\/portal"/);
    // and the overlay is still a full-viewport fixed layer INSIDE the portal
    expect(modal).toMatch(/fixed inset-0 z-\[\d+\]/);
  });

  it("answers each question on its own tab instead of one long scroll", () => {
    // Owner: "make the details not to take much of scrolling, just more of
    // clicking buttons to review details than scrolling."
    expect(modal).toMatch(/role="tablist"/);
    for (const t of ["overview", "downloads", "platforms", "pages", "activity"]) {
      expect(modal, `the ${t} tab is gone`).toContain(`"${t}"`);
    }
  });

  it("never calls a count of events a count of downloads", () => {
    /*
      One file emits requested → started → preparing → completed. Labelling four
      events as four downloads would overstate by 4x on a screen an operator
      makes decisions from — a fabricated stat with a chart behind it.
    */
    expect(modal).toMatch(/\{r\.count\} events/);
  });
});
