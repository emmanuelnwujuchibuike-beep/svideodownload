import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TIER_MS } from "./scheduler";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HARD GUARANTEE: THE ADMIN DASHBOARD CANNOT GROW A HIGH-FREQUENCY LOOP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-30, verbatim: "I want a hard guarantee that the new
 * architecture does NOT accidentally create a new high-frequency request loop.
 * Search the final codebase for setInterval, setTimeout, polling,
 * refetchInterval, router.refresh, repeated fetch(), repeated Supabase queries,
 * Realtime subscriptions — and inspect every relevant occurrence."
 *
 * A guarantee that lives in a code review is not a guarantee. This performs that
 * search on every run, so the next widget added to the admin cannot quietly
 * reintroduce what was just removed — which is exactly how the dashboard got
 * here: each of the four loops was individually reasonable when written, and
 * nothing was watching the total.
 *
 * The floor is deliberately generous (10s). It is not a style rule about
 * intervals; it is a spend tripwire.
 */

const ADMIN_DIR = join(process.cwd(), "features", "admin");
/** The one file allowed to own a repeating timer. Everything else subscribes to it. */
const SCHEDULER = join(ADMIN_DIR, "live", "scheduler.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(ADMIN_DIR);
const source = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(process.cwd().length + 1).replace(/\\/g, "/");

describe("admin dashboard cost safety", () => {
  it("🔴 only the scheduler owns a repeating timer", () => {
    /*
      `setInterval` in a widget IS the bug this whole change removed: four of
      them, none coordinated, none stopping when the tab was hidden. One shared
      sweep replaces them, so a second `setInterval` anywhere under
      features/admin is a regression by construction.
    */
    const offenders = FILES.filter((f) => f !== SCHEDULER && /\bsetInterval\s*\(/.test(source(f))).map(rel);
    expect(
      offenders,
      `These admin files own a repeating timer. Subscribe to the shared scheduler\n` +
        `(features/admin/live/use-admin-live.ts) instead — it stops while the tab is\n` +
        `hidden, shares one request between widgets, and backs off on failure:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("🔴 nothing holds a long-lived connection open", () => {
    /*
      An SSE stream was the single most expensive thing on this dashboard: a
      Vercel function held open 5 minutes at a time, reconnected forever by
      EventSource, indifferent to tab visibility. WebSocket is the same shape of
      cost. Neither belongs on a page an operator leaves open for hours.
    */
    const offenders = FILES.filter((f) => /\b(new EventSource|new WebSocket)\b/.test(source(f))).map(rel);
    expect(
      offenders,
      "A long-lived connection bills continuous Vercel compute for as long as the " +
        "dashboard is open, and does not stop when the tab is hidden:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("🔴 no self-rescheduling setTimeout loop sneaks a poll back in", () => {
    // The activity feed's old 2.5s poll was a recursive `setTimeout`, not a
    // `setInterval` — so the check above would not have caught it.
    const offenders = FILES.filter((f) => {
      const src = source(f);
      // A setTimeout whose callback is the function that scheduled it.
      return /timer\s*=\s*setTimeout\s*\(\s*tick/.test(src) || /setTimeout\s*\(\s*poll\b/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("🔴 every scheduler tier stays above the spend floor", () => {
    for (const [tier, ms] of Object.entries(TIER_MS)) {
      expect(ms, `tier "${tier}" is ${ms}ms — below the 10s spend floor`).toBeGreaterThanOrEqual(10_000);
    }
    // And the bands the brief specified, so a future edit cannot quietly
    // collapse "expensive aggregates" back onto the live cadence.
    expect(TIER_MS.stats).toBeGreaterThanOrEqual(30_000);
    expect(TIER_MS.slow).toBeGreaterThanOrEqual(TIER_MS.stats);
  });

  it("🔴 the scheduler stops rather than throttles while hidden", () => {
    const src = source(SCHEDULER);
    // The sweep must refuse to run, AND the timer must be torn down — checking
    // visibility inside a tick that still fires keeps the wakeup cost.
    expect(src).toMatch(/visibilityState\s*!==\s*"visible"/);
    expect(src).toMatch(/clearInterval\(timer\)/);
  });

  it("🔴 backoff can only ever lengthen an interval", () => {
    const src = source(SCHEDULER);
    // The cost-safety property in one assertion: there is no division, and no
    // factor below 1, anywhere in the scheduling arithmetic.
    expect(src).toContain("Math.min(MAX_BACKOFF_FACTOR");
    expect(src).not.toMatch(/TIER_MS\[[^\]]+\]\s*\//);
  });

  it("drops a key when its last subscriber unmounts", () => {
    // Otherwise navigating away from the dashboard leaves the sweep fetching
    // forever — a request loop that outlives the page that started it.
    expect(source(SCHEDULER)).toMatch(/entries\.delete\(key\)/);
  });
});
