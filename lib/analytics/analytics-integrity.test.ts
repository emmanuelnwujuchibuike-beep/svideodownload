import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isBotUA, parseUA } from "./enrich";
import { AD_METRICS, changePct, DOWNLOAD_METRICS, TRAFFIC_METRICS } from "./metric-catalogue";

/**
 * The analytics audit (owner, 2026-08-09), pinned.
 *
 * Every case below is a defect that was measured in the pipeline, not a
 * hypothetical. Where a fix lives in SQL or in browser-only code, the assertion
 * is made against the source that must contain it — a weaker check than
 * executing it, but it still fails loudly if someone removes the fix, which is
 * the job.
 */

/* ───────────────────────────── bot filtering ─────────────────────────────── */

describe("isBotUA — automated traffic was counted as people", () => {
  const REAL_PEOPLE = [
    // iPhone Safari — the single most common visitor to this site.
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    // Android Chrome.
    "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    // Desktop Chrome on Windows.
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    // Samsung Internet — very common in this site's Africa-primary audience.
    "Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    // Firefox on Linux.
    "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  ];

  it.each(REAL_PEOPLE)("does not delete a real visitor: %s", (ua) => {
    // A false positive here silently removes a person from every metric, which
    // is worse than the noise it filters. This is the assertion that matters.
    expect(isBotUA(ua)).toBe(false);
  });

  const BOTS = [
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
    "Playwright/1.44 (headless)",
  ];

  it.each(BOTS)("marks automated traffic: %s", (ua) => {
    expect(isBotUA(ua)).toBe(true);
  });

  it("treats a missing user agent as automated", () => {
    // A browser doing normal navigation always sends one.
    expect(isBotUA(null)).toBe(true);
    expect(isBotUA("")).toBe(true);
  });

  it("still parses device/browser for a bot — marked, never dropped", () => {
    // The row stays queryable so a mis-classification can be found and reversed.
    const ua = parseUA("Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/124.0.0.0 Safari/537.36");
    expect(ua.browser).toBeTruthy();
    expect(ua.device).toBeTruthy();
  });
});

/* ──────────────────────────── trend arithmetic ───────────────────────────── */

describe("changePct — an unknown trend must never render as flat", () => {
  it("computes a normal change", () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(80, 100)).toBe(-20);
  });

  it("returns null when there is no previous value to compare against", () => {
    // null means "no arrow at all". Returning 0 would claim the metric was flat,
    // which is a different — and false — statement.
    expect(changePct(50, null)).toBeNull();
  });

  it("refuses to express a rise from zero as a percentage", () => {
    // The card renders "new" for this. +100% and ∞ are both lies.
    expect(changePct(50, 0)).toBeNull();
  });

  it("reports zero-to-zero as genuinely flat", () => {
    expect(changePct(0, 0)).toBe(0);
  });
});

/* ─────────────────────────── metric definitions ──────────────────────────── */

const ALL_METRICS = [...TRAFFIC_METRICS, ...DOWNLOAD_METRICS, ...AD_METRICS];

describe("metric catalogue — every number explains itself", () => {
  it("has a unique id per metric", () => {
    const ids = ALL_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ALL_METRICS.map((m) => [m.id, m] as const))("%s carries a title, description and measurement note", (_id, m) => {
    expect(m.title.length).toBeGreaterThan(0);
    // Sentence case, no trailing colon — the stat-tile contract.
    expect(m.title.endsWith(":")).toBe(false);
    expect(m.description.length).toBeGreaterThan(10);
    // The tooltip is the whole point: it must actually say how the number is
    // produced, not restate the title.
    expect(m.measurement.length, `${m.id} has no real measurement note`).toBeGreaterThan(60);
    expect(m.measurement).not.toBe(m.description);
  });

  it("knows which direction is good for the metrics where it matters", () => {
    const byId = new Map(ALL_METRICS.map((m) => [m.id, m]));
    // The four that a naive dashboard gets wrong by painting every rise green.
    expect(byId.get("bounce")?.higherIsBetter).toBe(false);
    expect(byId.get("dl-failed")?.higherIsBetter).toBe(false);
    expect(byId.get("dl-abandoned")?.higherIsBetter).toBe(false);
    expect(byId.get("dl-success")?.higherIsBetter).toBe(true);
    // And the ones that are genuinely neither.
    expect(byId.get("sessions")?.higherIsBetter).toBeNull();
    expect(byId.get("dl-cancelled")?.higherIsBetter).toBeNull();
  });

  it("labels the estimated revenue as an estimate, in the tooltip", () => {
    const rev = ALL_METRICS.find((m) => m.id === "ad-revenue");
    expect(rev?.description).toMatch(/not money received|projection/i);
    expect(rev?.measurement).toMatch(/estimate|assumption|differ/i);
  });
});

/* ───────────────────── fixes that live in SQL / browser code ─────────────── */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the pipeline fixes are still in place", () => {
  const migration = read("supabase/migrations/0115_analytics_integrity.sql");

  it("orders download updates by EVENT time, so a replayed batch cannot regress a status", () => {
    expect(migration).toContain("last_event_at");
    expect(migration).toMatch(/NEW\.last_event_at\s*<=\s*OLD\.last_event_at/);
    expect(migration).toContain("analytics_downloads_latest_wins");
  });

  it("never lets a later event null out a known file size", () => {
    expect(migration).toMatch(/NEW\.file_size\s*:=\s*coalesce\(NEW\.file_size,\s*OLD\.file_size\)/);
  });

  it("excludes bots from every aggregate", () => {
    // Each RPC must filter. A single unfiltered one silently reintroduces the bug.
    const fns = migration.split(/create or replace function/).slice(1);
    const aggregates = fns.filter((f) => /analytics_(traffic_totals|breakdown|download_totals|visitor_split|page_traffic|timeseries|download_log)/.test(f));
    expect(aggregates.length).toBeGreaterThanOrEqual(7);
    for (const fn of aggregates) {
      const name = fn.slice(0, 60).replace(/\s+/g, " ");
      expect(fn, `no bot filter in ${name}`).toMatch(/is_bot = false/);
    }
  });

  it("counts DISTINCT session ids, not session_start events", () => {
    // Two tabs can each decide a session expired and both emit a start.
    expect(migration).toMatch(/count\(distinct session_id\)/);
  });

  it("keeps the RPCs off anon and authenticated", () => {
    expect(migration).toMatch(/revoke all on function/);
    expect(migration).toMatch(/grant execute on function .* to service_role/);
    // A `security definer` function reading an RLS-denied table MUST pin its
    // search_path, or a caller can shadow the objects it references.
    for (const fn of migration.split(/create or replace function/).slice(1)) {
      if (!/security definer/.test(fn)) continue;
      expect(fn, "security definer without a pinned search_path").toMatch(/set search_path/);
    }
  });

  it("clamps a client clock so a wrong device time cannot park events in the future", () => {
    const collect = read("app/api/analytics/collect/route.ts");
    expect(collect).toContain("occurredAtIso");
    expect(collect).toMatch(/Math\.min\(Math\.max\(/);
  });

  it("emits download_cancelled — it was declared but never sent", () => {
    const manager = read("features/downloads/manager.ts");
    expect(manager).toMatch(/trackDownload\("cancelled"/);
  });

  it("collapses a double-tap into one download", () => {
    const manager = read("features/downloads/manager.ts");
    expect(manager).toContain("inFlight");
    expect(manager).toMatch(/if \(inFlight\) return inFlight\.id/);
  });

  it("counts an ad impression on VIEWABILITY, not on load", () => {
    const slot = read("features/monetization/ad-slot.tsx");
    expect(slot).toContain("IntersectionObserver");
    expect(slot).toMatch(/threshold: 0\.5/);
    // A background tab reports as intersecting — the timer must also gate on it.
    expect(slot).toContain("visibilityState");
  });

  it("does not double-count the rewarded-ad impression", () => {
    const rewarded = read("features/monetization/rewarded-ad.tsx");
    // It may only beacon for the video it renders ITSELF; the nested AdSlot
    // owns the count for every other format.
    expect(rewarded).toMatch(/ad\.format === "video"/);
  });

  it("measures time on page from a real exit event", () => {
    const client = read("lib/analytics/client.ts");
    expect(client).toContain("page_exit");
    expect(client).toContain("dwellMs");
    // Background time is not attention.
    expect(client).toContain("visibilitychange");
    expect(client).toMatch(/dwellAccrued/);
  });

  it("does not re-count a page view for the same path", () => {
    const client = read("lib/analytics/client.ts");
    expect(client).toMatch(/if \(dwellPath === path\) return/);
  });
});
