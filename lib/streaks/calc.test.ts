import { describe, expect, it } from "vitest";

import {
  addDays,
  applyActivity,
  applyRestore,
  daysBetween,
  deriveStatus,
  emptyRecord,
  lastDays,
  localDay,
  localHour,
  mergeRecords,
  reconcile,
  reminderEligible,
  restorableStreak,
  restoreExpiresAt,
  restoreRemainingMs,
  safeZone,
  shouldCelebrate,
  streakLooksLost,
  trailingRun,
} from "./calc";
import { MAX_RESTORES, RESTORE_WINDOW_HOURS, type StreakRecord } from "./types";

/**
 * The brief's test list (§31) is almost entirely date-boundary behaviour, which
 * is exactly what `calc.ts` isolates. Everything here runs against the pure
 * functions — no database, no clock — so the awkward cases (DST, travelling
 * backwards across the dateline, a tampered timezone) are testable at all.
 */

const day = (r: Partial<StreakRecord> = {}): StreakRecord => ({ ...emptyRecord(), ...r });

describe("streaks · local calendar day", () => {
  it("names the local day, not the UTC one", () => {
    // 23:30 UTC on the 1st is already the 2nd in Tokyo and still the 1st in NYC.
    const instant = new Date("2026-03-01T23:30:00Z");
    expect(localDay(instant, "Asia/Tokyo")).toBe("2026-03-02");
    expect(localDay(instant, "America/New_York")).toBe("2026-03-01");
    expect(localDay(instant, "UTC")).toBe("2026-03-01");
  });

  it("falls back to UTC for a junk timezone instead of throwing", () => {
    // This value reaches us from the client, so it is untrusted input into Intl.
    expect(safeZone("Not/AZone")).toBe("UTC");
    expect(safeZone(null)).toBe("UTC");
    expect(safeZone("Europe/Lagos" as string)).toBe("UTC"); // not a real zone
    expect(safeZone("Africa/Lagos")).toBe("Africa/Lagos");
    expect(() => localDay(new Date(), "Not/AZone")).not.toThrow();
  });

  it("reads the local hour for the reminder window", () => {
    const instant = new Date("2026-03-01T18:00:00Z");
    expect(localHour(instant, "UTC")).toBe(18);
    expect(localHour(instant, "America/New_York")).toBe(13); // 1pm — before 2pm
  });
});

describe("streaks · day arithmetic survives DST", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    // US spring-forward: 2026-03-08 is a 23-hour local day.
    expect(daysBetween("2026-03-07", "2026-03-08")).toBe(1);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
    // Autumn fall-back: 2026-11-01 is a 25-hour local day.
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
  });

  it("handles month, year and leap boundaries", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1); // 2026 is not a leap year
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 is
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("lists a trailing week oldest-first", () => {
    expect(lastDays("2026-03-08", 7)).toEqual([
      "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
      "2026-03-06", "2026-03-07", "2026-03-08",
    ]);
  });
});

describe("streaks · the daily transition", () => {
  it("first ever visit starts at 1", () => {
    const out = applyActivity(emptyRecord(), "2026-03-01");
    expect(out.kind).toBe("started");
    expect(out.record.currentStreak).toBe(1);
    expect(out.record.longestStreak).toBe(1);
    expect(out.record.totalActiveDays).toBe(1);
    expect(out.record.streakStartedAt).toBe("2026-03-01");
  });

  it("the next calendar day increments", () => {
    const out = applyActivity(day({ currentStreak: 1, longestStreak: 1, lastActivityDate: "2026-03-01", streakStartedAt: "2026-03-01", totalActiveDays: 1 }), "2026-03-02");
    expect(out.kind).toBe("continued");
    expect(out.record.currentStreak).toBe(2);
    expect(out.record.totalActiveDays).toBe(2);
  });

  it("keeps incrementing indefinitely", () => {
    let record = emptyRecord();
    let d = "2026-03-01";
    for (let i = 0; i < 30; i += 1) {
      record = applyActivity(record, d).record;
      d = addDays(d, 1);
    }
    expect(record.currentStreak).toBe(30);
    expect(record.longestStreak).toBe(30);
    expect(record.totalActiveDays).toBe(30);
  });

  it("🔴 credits a calendar day exactly once, however many times it is called", () => {
    // Refresh, five tabs, PWA reopen, landing → download → wallpaper → profile.
    let record = applyActivity(emptyRecord(), "2026-03-01").record;
    for (let i = 0; i < 20; i += 1) {
      const out = applyActivity(record, "2026-03-01");
      expect(out.kind).toBe("already-today");
      record = out.record;
    }
    expect(record.currentStreak).toBe(1);
    expect(record.totalActiveDays).toBe(1);
  });

  it("🔴 a clock or timezone moving BACKWARDS never credits and never resets", () => {
    // Flying east→west across the dateline, or a fall-back DST edge.
    const record = day({ currentStreak: 9, longestStreak: 9, lastActivityDate: "2026-03-05", totalActiveDays: 9 });
    const out = applyActivity(record, "2026-03-04");
    expect(out.kind).toBe("already-today");
    expect(out.record.currentStreak).toBe(9);
    expect(out.record.totalActiveDays).toBe(9);
  });

  it("a missed day does NOT wipe the streak — it arms the restore window", () => {
    const record = day({ currentStreak: 12, longestStreak: 12, lastActivityDate: "2026-03-01", totalActiveDays: 12 });
    const out = applyActivity(record, "2026-03-03"); // skipped the 2nd
    expect(out.kind).toBe("reset");
    expect(out.record.currentStreak).toBe(1);
    expect(out.record.longestStreak).toBe(12); // never regresses
    expect(out.record.restoreDeadline).toBe("2026-03-04");
    expect(restorableStreak(out.record, "2026-03-03")).toBe(12);
  });

  it("coming back after the window has closed is a clean day 1", () => {
    const record = day({ currentStreak: 12, longestStreak: 12, lastActivityDate: "2026-03-01", totalActiveDays: 12 });
    const out = applyActivity(record, "2026-03-20");
    expect(out.record.currentStreak).toBe(1);
    expect(out.record.longestStreak).toBe(12);
    expect(out.record.restoreDeadline).toBeNull();
    expect(restorableStreak(out.record, "2026-03-20")).toBe(0);
  });
});

describe("streaks · restoration", () => {
  const broken = day({
    currentStreak: 1, longestStreak: 12, lastActivityDate: "2026-03-03",
    totalActiveDays: 13, restoreDeadline: "2026-03-04",
  });

  it("restores the interrupted streak inside the window", () => {
    const out = applyRestore(broken, "2026-03-03");
    expect(out?.currentStreak).toBe(12);
    expect(out?.restoreDeadline).toBeNull();
    expect(out?.restoresUsed).toBe(1);
  });

  it("refuses once the deadline has passed", () => {
    expect(restorableStreak(broken, "2026-03-05")).toBe(0);
    expect(applyRestore(broken, "2026-03-05")).toBeNull();
  });

  it("refuses when there is nothing to restore", () => {
    expect(applyRestore(day({ currentStreak: 4, longestStreak: 4 }), "2026-03-03")).toBeNull();
  });

  it("🔴 caps repeated restoration", () => {
    const abused = { ...broken, restoresUsed: MAX_RESTORES };
    expect(restorableStreak(abused, "2026-03-03")).toBe(0);
    expect(applyRestore(abused, "2026-03-03")).toBeNull();
  });

  it("longest_streak survives a break and a reset", () => {
    let record = day({ currentStreak: 28, longestStreak: 28, lastActivityDate: "2026-03-01", totalActiveDays: 28 });
    record = applyActivity(record, "2026-03-20").record;
    expect(record.currentStreak).toBe(1);
    expect(record.longestStreak).toBe(28);
  });
});

describe("streaks · status machine", () => {
  it("names each state", () => {
    expect(deriveStatus(emptyRecord(), "2026-03-01", 9)).toBe("NEW");
    /*
      🔴 PENDING TRACKS A FLAME UPGRADE, NOT A DAY (owner, 2026-09-01: "there
      shoudnlt be a celebration everyday, only on flame upgrade").

      Day 3 is an ordinary day inside the spark tier and now completes without
      pending anything — it used to report CELEBRATION_PENDING until midnight
      for an overlay that would never mount. Day 1 and day 7 ARE rungs.
    */
    expect(deriveStatus(day({ currentStreak: 3, lastActivityDate: "2026-03-01" }), "2026-03-01", 9)).toBe("COMPLETED_TODAY");
    expect(deriveStatus(day({ currentStreak: 1, lastActivityDate: "2026-03-01" }), "2026-03-01", 9)).toBe("COMPLETED_TODAY");
    expect(deriveStatus(day({ currentStreak: 2, lastActivityDate: "2026-03-01" }), "2026-03-01", 9)).toBe("CELEBRATION_PENDING");
    expect(deriveStatus(day({ currentStreak: 7, lastActivityDate: "2026-03-01" }), "2026-03-01", 9)).toBe("CELEBRATION_PENDING");
    expect(deriveStatus(day({ currentStreak: 7, lastActivityDate: "2026-03-01", lastCelebrationDate: "2026-03-01" }), "2026-03-01", 9)).toBe("CELEBRATED_TODAY");
    // Yesterday's activity, before and after the 2pm line.
    expect(deriveStatus(day({ currentStreak: 3, lastActivityDate: "2026-03-01" }), "2026-03-02", 9)).toBe("ACTIVE");
    expect(deriveStatus(day({ currentStreak: 3, lastActivityDate: "2026-03-01" }), "2026-03-02", 14)).toBe("AT_RISK");
    expect(deriveStatus(day({ currentStreak: 1, longestStreak: 12, lastActivityDate: "2026-03-03", restoreDeadline: "2026-03-04" }), "2026-03-03", 9)).toBe("RESTORABLE");
    expect(deriveStatus(day({ currentStreak: 5, lastActivityDate: "2026-02-01" }), "2026-03-02", 9)).toBe("MISSED");
  });
});

describe("streaks · celebration fires once, and only on a flame upgrade", () => {
  it("celebrates a rung once, then never again that day", () => {
    const record = day({ currentStreak: 7, lastActivityDate: "2026-03-02" });
    expect(shouldCelebrate(record, "2026-03-02")).toBe(true);
    const celebrated = { ...record, lastCelebrationDate: "2026-03-02" };
    // Refresh, route change, PWA reopen, opening Profile — all of these.
    for (let i = 0; i < 10; i += 1) {
      expect(shouldCelebrate(celebrated, "2026-03-02")).toBe(false);
    }
    // …and it comes back at the NEXT rung, not the next day.
    expect(shouldCelebrate({ ...celebrated, currentStreak: 8, lastActivityDate: "2026-03-03" }, "2026-03-03")).toBe(false);
    expect(shouldCelebrate({ ...celebrated, currentStreak: 14, lastActivityDate: "2026-03-09" }, "2026-03-09")).toBe(true);
  });

  it("🔴 does NOT celebrate an ordinary day (owner, 2026-09-01)", () => {
    /*
      "there shoudnlt be a celebration everyday, only on flame upgrade."

      This is the whole behavioural change of 2026-09-01 and it is the thing
      most likely to be undone by accident, because every one of these days
      used to return true. Days 2–6, 8–13, 15–29 and 31 are all banked
      activity on a live streak, and none of them is a rung.
    */
    for (const streak of [1, 3, 4, 5, 6, 8, 13, 15, 29, 31, 99, 101, 364, 366]) {
      expect(
        shouldCelebrate(day({ currentStreak: streak, lastActivityDate: "2026-03-01" }), "2026-03-01"),
        `day ${streak} is not a flame upgrade`,
      ).toBe(false);
    }
  });

  it("🔴🔴 does NOT celebrate day 1 — the celebration lands on day 2", () => {
    /*
      Owner, 2026-09-01: "the new flame unlock celebration card should only
      show on the second day not on the first day and first time a user is
      entrying the site." The chip still appears on day 1; only the ceremony
      moves. See `celebrateAtDays` in tiers.ts for why these are two fields.
    */
    expect(shouldCelebrate(day({ currentStreak: 1, lastActivityDate: "2026-03-01" }), "2026-03-01")).toBe(false);
    expect(shouldCelebrate(day({ currentStreak: 2, lastActivityDate: "2026-03-01" }), "2026-03-01")).toBe(true);
  });
  it("celebrates every rung on the ladder, and nothing between them", () => {
    for (const streak of [2, 7, 14, 30, 100, 365]) {
      expect(
        shouldCelebrate(day({ currentStreak: streak, lastActivityDate: "2026-03-01" }), "2026-03-01"),
        `day ${streak} is a rung`,
      ).toBe(true);
    }
  });

  it("never celebrates a day whose activity is not banked", () => {
    expect(shouldCelebrate(day({ currentStreak: 5, lastActivityDate: "2026-03-01" }), "2026-03-02")).toBe(false);
  });
});

describe("streaks · 2pm reminder eligibility", () => {
  const live = day({ currentStreak: 6, lastActivityDate: "2026-03-01" });

  it("fires after 2pm local for a live streak with nothing today", () => {
    expect(reminderEligible(live, "2026-03-02", 14)).toBe(true);
  });

  it("stays silent before 2pm", () => {
    expect(reminderEligible(live, "2026-03-02", 13)).toBe(false);
  });

  it("stays silent once today is already done", () => {
    expect(reminderEligible({ ...live, lastActivityDate: "2026-03-02" }, "2026-03-02", 20)).toBe(false);
  });

  it("🔴 sends at most one per calendar day", () => {
    expect(reminderEligible({ ...live, lastReminderDate: "2026-03-02" }, "2026-03-02", 20)).toBe(false);
  });

  it("does not nudge someone with no streak, or one already long gone", () => {
    expect(reminderEligible(day({ currentStreak: 0 }), "2026-03-02", 20)).toBe(false);
    expect(reminderEligible(day({ currentStreak: 6, lastActivityDate: "2026-02-20" }), "2026-03-02", 20)).toBe(false);
  });
});

describe("streaks · anonymous → signed-in merge", () => {
  it("takes the best of each side and never sums", () => {
    const account = day({ currentStreak: 2, longestStreak: 4, lastActivityDate: "2026-03-02", totalActiveDays: 5, streakStartedAt: "2026-03-01" });
    const anon = day({ currentStreak: 7, longestStreak: 7, lastActivityDate: "2026-03-02", totalActiveDays: 7, streakStartedAt: "2026-02-24" });
    const merged = mergeRecords(account, anon);
    expect(merged.currentStreak).toBe(7); // the brief's worked example
    expect(merged.longestStreak).toBe(7);
    expect(merged.totalActiveDays).toBe(7); // NOT 12 — no inflation
    expect(merged.streakStartedAt).toBe("2026-02-24");
  });

  it("🔴 is idempotent — sign-in can fire more than once", () => {
    const account = day({ currentStreak: 1, longestStreak: 1, totalActiveDays: 1 });
    const anon = day({ currentStreak: 7, longestStreak: 9, totalActiveDays: 12, restoresUsed: 2 });
    const once = mergeRecords(account, anon);
    const twice = mergeRecords(once, anon);
    expect(twice).toEqual(once);
  });

  it("carries the later celebration mark so a merge cannot replay the animation", () => {
    const merged = mergeRecords(
      day({ lastCelebrationDate: null }),
      day({ lastCelebrationDate: "2026-03-02" }),
    );
    expect(merged.lastCelebrationDate).toBe("2026-03-02");
    expect(shouldCelebrate({ ...merged, currentStreak: 5, lastActivityDate: "2026-03-02" }, "2026-03-02")).toBe(false);
  });

  it("carries the higher restore count so merging cannot refill the allowance", () => {
    expect(mergeRecords(day({ restoresUsed: 0 }), day({ restoresUsed: 3 })).restoresUsed).toBe(3);
  });
});

describe("streaks · the 48-hour recovery window (§7)", () => {
  /* Last download Tuesday; the streak breaks at Wednesday 00:00 local. */
  const broken = day({
    currentStreak: 1, longestStreak: 12, lastActivityDate: "2026-03-03",
    totalActiveDays: 13, restoreDeadline: "2026-03-06", timezone: "UTC",
  });

  it("🔴 counts from the BREAK, not from the last download", () => {
    /*
      The streak was alive all of the 3rd — it only broke when the 4th began.
      Measuring from the activity instead would silently cost every member up
      to a whole day of the window they were promised.
    */
    expect(restoreExpiresAt(broken, "UTC")?.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });

  it("is open before 48 hours and closed at exactly 48", () => {
    const open = new Date("2026-03-05T23:59:00Z");
    const shut = new Date("2026-03-06T00:00:00Z");
    expect(restoreRemainingMs(broken, open, "UTC")).toBeGreaterThan(0);
    // ≥48 HOURS: RESTORE STREAK UNAVAILABLE. Exactly 48 is already closed.
    expect(restoreRemainingMs(broken, shut, "UTC")).toBe(0);
    expect(restoreRemainingMs(broken, new Date("2026-03-07T00:00:00Z"), "UTC")).toBe(0);
  });

  it("reports the remaining time the countdown renders", () => {
    const ms = restoreRemainingMs(broken, new Date("2026-03-04T00:13:00Z"), "UTC");
    expect(Math.round(ms / 60000)).toBe(47 * 60 + 47); // "23h 47m" is 47h47m out
  });

  it("🔴 is anchored in the MEMBER-S zone, not UTC", () => {
    /*
      Midnight in Auckland is 11:00 the previous day in UTC. A window anchored
      at UTC midnight would open and close 13 hours off for them — half a day
      of a two-day window.
    */
    const nz = { ...broken, timezone: "Pacific/Auckland" };
    expect(restoreExpiresAt(nz, "Pacific/Auckland")?.toISOString()).toBe("2026-03-05T11:00:00.000Z");
    const la = { ...broken, timezone: "America/Los_Angeles" };
    expect(restoreExpiresAt(la, "America/Los_Angeles")?.toISOString()).toBe("2026-03-06T08:00:00.000Z");
  });

  it("survives a DST cutover inside the window", () => {
    // US spring-forward is 2026-03-08; the local day is 23 hours long.
    const dst = day({
      currentStreak: 1, longestStreak: 9, lastActivityDate: "2026-03-07",
      restoreDeadline: "2026-03-10", timezone: "America/New_York",
    });
    const expiry = restoreExpiresAt(dst, "America/New_York");
    // Breaks at 2026-03-08 00:00 EST (05:00Z); +48h lands at 05:00Z on the 10th.
    expect(expiry?.toISOString()).toBe("2026-03-10T05:00:00.000Z");
  });

  it("has nothing to expire when nothing broke", () => {
    expect(restoreExpiresAt(day({ currentStreak: 5, lastActivityDate: "2026-03-03" }), "UTC")).toBeNull();
    expect(restoreRemainingMs(day(), new Date(), "UTC")).toBe(0);
  });

  it("is strictly tighter than the stored calendar deadline", () => {
    /*
      Both gates are applied in engine.ts and this is why the order does not
      matter: 48 hours can never outlast a 3-calendar-day deadline, so the
      hour rule is always the binding one.
    */
    expect(RESTORE_WINDOW_HOURS).toBe(48);
    const stillCalendarValid = restorableStreak(broken, "2026-03-06");
    expect(stillCalendarValid).toBe(12); // the DATE gate would still allow it
    expect(restoreRemainingMs(broken, new Date("2026-03-06T09:00:00Z"), "UTC")).toBe(0);
  });
});

describe("🔴 reconciliation — the counter drifted from the ledger in production", () => {
  /*
    Real rows, found on 2026-09-02. The ledger was complete and gap-free while
    the counter sat frozen — the streaks UPDATE behind the ledger insert had
    not landed, and because the old repair path only compared DATES it could
    never notice a wrong COUNT once last_activity_date had caught up.
  */
  const stuck = day({
    currentStreak: 4,
    longestStreak: 4,
    totalActiveDays: 4,
    streakStartedAt: "2026-08-24",
    lastActivityDate: "2026-09-02",
  });

  it("🔴 spots a lost update for free, from two fields already on the row", () => {
    // 2026-08-24 -> 2026-09-02 is a ten-day span; the counter says four.
    expect(streakLooksLost(stuck)).toBe(true);
  });

  it("🔴 says nothing about a healthy record — the common case pays nothing", () => {
    for (const n of [1, 2, 7, 30, 365]) {
      const healthy = day({
        currentStreak: n,
        streakStartedAt: "2026-01-01",
        lastActivityDate: addDays("2026-01-01", n - 1),
      });
      expect(streakLooksLost(healthy), `${n}-day streak`).toBe(false);
    }
  });

  it("🔴 never flags a counter that is too HIGH — that is a different fault", () => {
    // Repairing upward is safe; repairing downward would destroy progress on a
    // transient read failure, so this path must not even see it.
    expect(
      streakLooksLost(day({ currentStreak: 40, streakStartedAt: "2026-08-24", lastActivityDate: "2026-09-02" })),
    ).toBe(false);
  });

  it("counts the trailing run, and only when it reaches today", () => {
    const run = ["2026-08-31", "2026-09-01", "2026-09-02"];
    expect(trailingRun(run, "2026-09-02")).toBe(3);
    // A run that stopped yesterday is not a live streak.
    expect(trailingRun(run, "2026-09-03")).toBe(0);
    expect(trailingRun([], "2026-09-02")).toBe(0);
  });

  it("is not fooled by unsorted or duplicated ledger rows", () => {
    const messy = ["2026-09-02", "2026-08-31", "2026-09-01", "2026-09-02", "2026-08-31"];
    expect(trailingRun(messy, "2026-09-02")).toBe(3);
  });

  it("stops at a real gap rather than counting through it", () => {
    // 08-28 is missing: the live run is only the three days after it.
    const gapped = ["2026-08-26", "2026-08-27", "2026-08-31", "2026-09-01", "2026-09-02"];
    expect(trailingRun(gapped, "2026-09-02")).toBe(3);
  });

  it("🔴 repairs the real stuck row to what the ledger proves", () => {
    const ledger = [
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
      "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
    ];
    const fixed = reconcile(stuck, ledger, "2026-09-02")!;
    expect(fixed.currentStreak).toBe(10);
    expect(fixed.longestStreak).toBe(10);
    expect(fixed.totalActiveDays).toBe(10);
    expect(fixed.streakStartedAt).toBe("2026-08-24");
    // …and the repaired record no longer contradicts itself.
    expect(streakLooksLost(fixed)).toBe(false);
  });

  it("🔴 refuses to LOWER a streak, whatever the ledger is missing", () => {
    /*
      A partial ledger read must cost nobody their progress. `reconcile`
      returns null unless it can prove a LONGER run than the row claims.
    */
    expect(reconcile(stuck, ["2026-09-01", "2026-09-02"], "2026-09-02")).toBeNull();
    expect(reconcile(stuck, [], "2026-09-02")).toBeNull();
  });

  it("repairs only up to the real gap, not the whole ledger", () => {
    const gapped = ["2026-08-24", "2026-08-25", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"];
    const fixed = reconcile(day({ currentStreak: 2, streakStartedAt: "2026-08-24", lastActivityDate: "2026-09-02" }), gapped, "2026-09-02")!;
    expect(fixed.currentStreak).toBe(4);
    expect(fixed.streakStartedAt).toBe("2026-08-30");
  });
});
