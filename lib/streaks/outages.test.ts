import { describe, expect, it } from "vitest";

import { applyActivity } from "./calc";
import { SERVICE_OUTAGES, outageDaysMissed, type ServiceOutage } from "./outages";
import type { StreakRecord } from "./types";

/**
 * The two-day outage of 2026-09-04..06 (owner: "Server was down for 2 days sice
 * saturday. Restore all lost streaks from Friday last week.").
 *
 * These assertions are about REAL PEOPLE'S streaks, so they are written as the
 * scenarios rather than as unit cases: who kept their streak, who did not, and
 * why. The dangerous direction is over-forgiving — handing a streak to someone
 * who genuinely stopped downloading — so every "still breaks" case below matters
 * more than the ones that pass.
 */

const base: StreakRecord = {
  currentStreak: 12,
  longestStreak: 30,
  lastActivityDate: null,
  streakStartedAt: null,
  totalActiveDays: 40,
  restoreDeadline: null,
  restoresUsed: 0,
  timeZone: "UTC",
};

const on = (lastActivityDate: string): StreakRecord => ({ ...base, lastActivityDate });

describe("outageDaysMissed", () => {
  it("counts only the days BETWEEN the two dates, never the endpoints", () => {
    // `last` is a day they were active and `today` is the day they came back —
    // neither can be a day they missed.
    expect(outageDaysMissed("2026-09-04", "2026-09-05")).toBe(0);
    expect(outageDaysMissed("2026-09-04", "2026-09-06")).toBe(1); // 09-05 only
    expect(outageDaysMissed("2026-09-04", "2026-09-07")).toBe(2); // 09-05, 09-06
  });

  it("counts nothing for a gap that does not touch the outage", () => {
    expect(outageDaysMissed("2026-08-01", "2026-08-10")).toBe(0);
    expect(outageDaysMissed("2026-09-07", "2026-09-20")).toBe(0);
  });

  it("clamps a gap that only partly overlaps", () => {
    // Away since late August, back on the 6th: only 09-04 and 09-05 are inside.
    expect(outageDaysMissed("2026-08-30", "2026-09-06")).toBe(2);
  });

  it("does not walk the calendar for an enormous gap", () => {
    // Arithmetic, not iteration — a three-year gap must still be instant.
    expect(outageDaysMissed("2023-01-01", "2026-09-07")).toBe(3);
  });

  it("has no overlapping ranges — an overlap would forgive more than happened", () => {
    const sorted = [...SERVICE_OUTAGES].sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.from > sorted[i - 1]!.to).toBe(true);
    }
    for (const o of SERVICE_OUTAGES) {
      expect(o.from <= o.to).toBe(true);
      expect(o.note.length).toBeGreaterThan(20); // an audit trail, not a label
    }
  });
});

describe("applyActivity across the 2026-09-04..06 outage", () => {
  it("KEEPS the streak for someone active Friday who returns Monday", () => {
    const out = applyActivity(on("2026-09-04"), "2026-09-07");
    expect(out.kind).toBe("continued");
    expect(out.record.currentStreak).toBe(13);
  });

  it("KEEPS the streak for someone active Thursday who returns Monday", () => {
    // Friday is inside the window the owner asked to restore from.
    const out = applyActivity(on("2026-09-03"), "2026-09-07");
    expect(out.kind).toBe("continued");
    expect(out.record.currentStreak).toBe(13);
  });

  it("awards exactly ONE day, never one per forgiven day", () => {
    // Forgiving is not crediting. They downloaded on one day; the outage days
    // were not days they were active, and inventing them would be fabricating
    // activity.
    const out = applyActivity(on("2026-09-03"), "2026-09-07");
    expect(out.record.currentStreak).toBe(base.currentStreak + 1);
    expect(out.record.totalActiveDays).toBe(base.totalActiveDays + 1);
  });

  it("STILL BREAKS for someone who had already stopped before the outage", () => {
    // Last active Wednesday: they missed Thursday on their own, which the
    // outage does not excuse.
    const out = applyActivity(on("2026-09-02"), "2026-09-07");
    expect(out.kind).toBe("reset");
    expect(out.record.currentStreak).toBe(1);
  });

  it("STILL BREAKS for someone who did not come back until well after", () => {
    const out = applyActivity(on("2026-09-04"), "2026-09-20");
    expect(out.kind).toBe("reset");
  });

  it("leaves gaps nowhere near the outage exactly as they were", () => {
    expect(applyActivity(on("2026-07-01"), "2026-07-02").kind).toBe("continued");
    expect(applyActivity(on("2026-07-01"), "2026-07-05").kind).toBe("reset");
  });

  it("never produces a gap below 1, however wide the outage", () => {
    // A hypothetical outage covering everything must not turn a real return
    // into the "already today" case, which would silently credit nothing.
    const wide: ServiceOutage[] = [{ from: "2000-01-01", to: "2099-01-01", note: "hypothetical, for the floor" }];
    expect(outageDaysMissed("2026-09-01", "2026-09-30", wide)).toBe(28);
    const out = applyActivity(on("2026-09-01"), "2026-09-30");
    // Real config: this gap is untouched and still a reset.
    expect(out.kind).toBe("reset");
  });
});
