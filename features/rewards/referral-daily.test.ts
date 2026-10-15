import { describe, expect, it } from "vitest";

import { countDownload, DAILY_AT, isSnoozed, readDaily, snoozeUntil, type DailyState } from "./referral-daily";

// owner, 2026-10-12: the Earn modal shows once a day, on the first download of that day
describe("referral modal — once a day, on the first download", () => {
  const day = (h: number, d = 12) => new Date(2026, 9, d, h, 0, 0);
  it("the first download of the day shows it", () => {
    expect(DAILY_AT).toBe(1);
    expect(countDownload(null, day(9)).due).toBe(true);
    expect(countDownload({ day: "2026-10-11", count: 5, shown: true }, day(9)).due).toBe(true);
  });
  it("once it has shown that day, the 5th, 6th … do not", () => {
    const shown: DailyState = { day: "2026-10-12", count: 4, shown: true };
    expect(countDownload(shown, day(18)).due).toBe(false);
    expect(countDownload({ ...shown, count: 9 }, day(19)).due).toBe(false);
  });
  it("not shown yet (an ad was in the way) → the next download that day tries again", () => {
    expect(countDownload({ day: "2026-10-12", count: 4, shown: false }, day(20)).due).toBe(true);
  });
  it("a new day starts again — and its first download shows it", () => {
    const r = countDownload({ day: "2026-10-12", count: 30, shown: true }, day(8, 13));
    expect(r.state).toEqual({ day: "2026-10-13", count: 1, shown: false });
    expect(r.due).toBe(true);
  });
  it("anything malformed in storage is a fresh day", () => {
    expect(readDaily("{oops")).toBeNull();
    expect(readDaily(JSON.stringify({ day: 1 }))).toBeNull();
    expect(readDaily(null)).toBeNull();
  });
});

// owner, 2026-10-15: "I understood, don't show this again this week"
describe("referral modal — the one-week snooze", () => {
  const now = new Date(2026, 9, 15, 9, 0, 0);
  it("is quiet for 7 days after 'I understood', then back", () => {
    const until = String(snoozeUntil(now));
    expect(isSnoozed(until, now)).toBe(true);
    expect(isSnoozed(until, new Date(2026, 9, 21, 23, 0))).toBe(true);
    expect(isSnoozed(until, new Date(2026, 9, 22, 9, 1))).toBe(false);
  });
  it("nothing stored or malformed is not a snooze", () => {
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed("soon", now)).toBe(false);
  });
});
