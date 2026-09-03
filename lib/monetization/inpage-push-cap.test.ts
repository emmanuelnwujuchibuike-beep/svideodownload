import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `inpage-push-cap.ts` keeps its fallback counter in a module-level variable
 * (see its own doc comment for why), so every test re-imports the module fresh
 * via `vi.resetModules()` — otherwise a mutation in one test would leak into
 * the next. This suite runs in the project's default node test environment
 * (no jsdom — see vitest.config.ts), so `window` is undefined throughout,
 * which exercises exactly the in-memory-fallback branch every test needs
 * anyway: the "localStorage unavailable" path IS the code path under test.
 */

type CapModule = typeof import("./inpage-push-cap");

async function freshModule(): Promise<CapModule> {
  vi.resetModules();
  return import("./inpage-push-cap");
}

describe("localDateKey", () => {
  it("formats a date as local YYYY-MM-DD, zero-padded", async () => {
    const { localDateKey } = await freshModule();
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05"); // Jan 5 — month + day both need padding
    expect(localDateKey(new Date(2026, 10, 23))).toBe("2026-11-23");
  });
});

describe("readInPagePushCap / recordInPagePushImpression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0/not-reached before anything is recorded", async () => {
    const { readInPagePushCap } = await freshModule();
    const state = readInPagePushCap(5);
    expect(state).toEqual({ count: 0, limit: 5, limitReached: false, remaining: 5 });
  });

  it("increments on each recorded impression and reports remaining correctly", async () => {
    const { readInPagePushCap, recordInPagePushImpression } = await freshModule();
    expect(recordInPagePushImpression(5).count).toBe(1);
    expect(recordInPagePushImpression(5).count).toBe(2);
    const state = recordInPagePushImpression(5);
    expect(state).toEqual({ count: 3, limit: 5, limitReached: false, remaining: 2 });
    expect(readInPagePushCap(5)).toEqual(state); // read-back agrees with the last write
  });

  it("reaches the cap at exactly `limit` and never reports it early", async () => {
    const { recordInPagePushImpression } = await freshModule();
    for (let i = 1; i < 5; i++) {
      expect(recordInPagePushImpression(5).limitReached).toBe(false);
    }
    expect(recordInPagePushImpression(5)).toEqual({ count: 5, limit: 5, limitReached: true, remaining: 0 });
  });

  it("respects a custom daily limit (not hardcoded to 5)", async () => {
    const { recordInPagePushImpression } = await freshModule();
    expect(recordInPagePushImpression(1)).toEqual({ count: 1, limit: 1, limitReached: true, remaining: 0 });
  });

  it("resets automatically when the local calendar day changes — no timer required", async () => {
    vi.setSystemTime(new Date(2026, 5, 14, 23, 59, 0)); // 11:59 PM, June 14
    const { readInPagePushCap, recordInPagePushImpression } = await freshModule();

    for (let i = 0; i < 5; i++) recordInPagePushImpression(5);
    expect(readInPagePushCap(5).limitReached).toBe(true);

    // Cross local midnight — no setTimeout fired, no code ran; the date key
    // itself is now different, which is the entire reset mechanism.
    vi.setSystemTime(new Date(2026, 5, 15, 0, 0, 30)); // 12:00:30 AM, June 15
    expect(readInPagePushCap(5)).toEqual({ count: 0, limit: 5, limitReached: false, remaining: 5 });
  });

  it("uses the VISITOR'S LOCAL date, not UTC — a stored local date must not be reinterpreted as UTC", async () => {
    // 1 AM local time is still "yesterday" in UTC+ zones and "today" in UTC-
    // zones depending on offset; the point is localDateKey must be driven by
    // the local Date fields (getFullYear/getMonth/getDate), never
    // toISOString(). Constructing via local-component Date() and reading back
    // through the same local-component path pins that no UTC conversion
    // sneaks in anywhere on the read/write round trip.
    vi.setSystemTime(new Date(2026, 2, 1, 1, 0, 0)); // 1:00 AM local, March 1
    const { readInPagePushCap, recordInPagePushImpression, localDateKey } = await freshModule();
    expect(localDateKey()).toBe("2026-03-01");
    recordInPagePushImpression(5);
    expect(readInPagePushCap(5).count).toBe(1);
  });
});

describe("skip cooldown (owner: 60 seconds after a skip)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not in cooldown before anything has been skipped", async () => {
    const { readInPagePushSkip } = await freshModule();
    expect(readInPagePushSkip(1_000)).toEqual({
      skippedAt: null,
      cooldownMs: 60_000,
      remainingMs: 0,
      inCooldown: false,
    });
  });

  it("blocks for exactly 60 seconds and reports the remainder while it runs", async () => {
    const t0 = new Date(2026, 8, 3, 12, 0, 0).getTime();
    const { readInPagePushSkip, recordInPagePushSkip } = await freshModule();

    expect(recordInPagePushSkip(t0)).toEqual({
      skippedAt: t0,
      cooldownMs: 60_000,
      remainingMs: 60_000,
      inCooldown: true,
    });

    expect(readInPagePushSkip(t0 + 25_000).remainingMs).toBe(35_000);
    // The last millisecond still counts as inside the window...
    expect(readInPagePushSkip(t0 + 59_999).inCooldown).toBe(true);
    // ...and the boundary itself releases it, rather than a tick later.
    expect(readInPagePushSkip(t0 + 60_000)).toEqual({
      skippedAt: t0,
      cooldownMs: 60_000,
      remainingMs: 0,
      inCooldown: false,
    });
  });

  it("does NOT hand back a fresh daily allowance — a skip must not reset the cap", async () => {
    vi.setSystemTime(new Date(2026, 8, 3, 12, 0, 0));
    const { readInPagePushCap, recordInPagePushImpression, recordInPagePushSkip } = await freshModule();

    recordInPagePushImpression(5);
    recordInPagePushImpression(5);
    recordInPagePushSkip(Date.now());

    expect(readInPagePushCap(5).count).toBe(2);
  });

  it("holds its 60 seconds ACROSS local midnight, where the daily counter resets", async () => {
    // The counter is date-keyed and resets at midnight; the cooldown is an
    // absolute timestamp and must not be cut short by the day boundary.
    const skipAt = new Date(2026, 8, 3, 23, 59, 30).getTime();
    vi.setSystemTime(skipAt);
    const { readInPagePushCap, readInPagePushSkip, recordInPagePushImpression, recordInPagePushSkip } =
      await freshModule();

    recordInPagePushImpression(5);
    recordInPagePushSkip(skipAt);

    // 40 seconds later it is 00:00:10 — a new calendar day, mid-cooldown.
    const nextDay = skipAt + 40_000;
    vi.setSystemTime(nextDay);
    expect(readInPagePushCap(5).count).toBe(0); // the day rolled over, as designed
    expect(readInPagePushSkip(nextDay)).toEqual({
      skippedAt: skipAt,
      cooldownMs: 60_000,
      remainingMs: 20_000,
      inCooldown: true,
    });
  });

  it("survives an impression recorded on the NEW day without losing the running cooldown", async () => {
    const skipAt = new Date(2026, 8, 3, 23, 59, 30).getTime();
    vi.setSystemTime(skipAt);
    const { readInPagePushSkip, recordInPagePushImpression, recordInPagePushSkip } = await freshModule();
    recordInPagePushSkip(skipAt);

    const nextDay = skipAt + 45_000; // 00:00:15 — genuinely tomorrow
    vi.setSystemTime(nextDay);
    recordInPagePushImpression(5); // rewrites the record under tomorrow's date key

    expect(readInPagePushSkip(nextDay).inCooldown).toBe(true);
    expect(readInPagePushSkip(nextDay).remainingMs).toBe(15_000);
  });

  it("FAILS OPEN when the clock moves backwards — a stuck cooldown would cost revenue", async () => {
    const { readInPagePushSkip, recordInPagePushSkip } = await freshModule();
    const future = new Date(2027, 0, 1).getTime();
    recordInPagePushSkip(future);

    // "Now" is a year before the stored skip: serve the ad rather than block
    // forever on a clock we cannot trust.
    const now = new Date(2026, 0, 1).getTime();
    expect(readInPagePushSkip(now)).toEqual({
      skippedAt: future,
      cooldownMs: 60_000,
      remainingMs: 0,
      inCooldown: false,
    });
  });

  it("respects a custom cooldown window rather than hardcoding 60s", async () => {
    const { readInPagePushSkip, recordInPagePushSkip } = await freshModule();
    recordInPagePushSkip(1_000, 5_000);
    expect(readInPagePushSkip(4_000, 5_000).inCooldown).toBe(true);
    expect(readInPagePushSkip(6_000, 5_000).inCooldown).toBe(false);
  });
});
