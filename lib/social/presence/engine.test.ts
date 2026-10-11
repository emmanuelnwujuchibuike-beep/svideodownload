import { describe, expect, it } from "vitest";

import {
  audienceAllows,
  effectivePresence,
  EVERY_DAY,
  FOCUS_MODES,
  FOCUS_SPECS,
  localClock,
  nextLocalTime,
  presenceLine,
  scheduleActive,
  smartSuggestions,
  WEEKDAYS,
  type PresenceRow,
  type PresenceSchedule,
} from "./engine";

const row = (p: Partial<PresenceRow> = {}): PresenceRow => ({ status: "available", customText: null, customUntil: null, focusMode: null, focusUntil: null, autoReply: null, openTo: [], audience: "everyone", ...p });
const sched = (p: Partial<PresenceSchedule> = {}): PresenceSchedule => ({ id: "s", mode: "sleep", days: EVERY_DAY, startMin: 23 * 60, endMin: 7 * 60, tz: "UTC", enabled: true, ...p });
// 2026-10-12 is a Monday
const at = (iso: string) => new Date(iso);

describe("schedules (Presence Automation)", () => {
  it("an overnight window is on late at night and in the early morning, off at midday", () => {
    expect(scheduleActive(sched(), at("2026-10-12T23:30:00Z"))).toBe(true);
    expect(scheduleActive(sched(), at("2026-10-12T06:59:00Z"))).toBe(true);
    expect(scheduleActive(sched(), at("2026-10-12T12:00:00Z"))).toBe(false);
    expect(scheduleActive(sched(), at("2026-10-12T07:00:00Z"))).toBe(false);
  });

  it("the morning part belongs to the day the window STARTED", () => {
    // Sunday night only: Monday 03:00 is still inside it, Sunday 03:00 is not
    const sundayOnly = sched({ days: 0b0000001 });
    expect(scheduleActive(sundayOnly, at("2026-10-12T03:00:00Z"))).toBe(true);
    expect(scheduleActive(sundayOnly, at("2026-10-11T03:00:00Z"))).toBe(false);
  });

  it("weekday working hours are off at the weekend, and a disabled rule never runs", () => {
    const work = sched({ mode: "work", days: WEEKDAYS, startMin: 9 * 60, endMin: 17 * 60 });
    expect(scheduleActive(work, at("2026-10-12T10:00:00Z"))).toBe(true);
    expect(scheduleActive(work, at("2026-10-11T10:00:00Z"))).toBe(false);
    expect(scheduleActive({ ...work, enabled: false }, at("2026-10-12T10:00:00Z"))).toBe(false);
  });

  it("reads the member's own time zone, and an unknown zone falls back to UTC", () => {
    // 10:00 UTC is 06:00 in New York (EDT)
    expect(localClock(at("2026-10-12T10:00:00Z"), "America/New_York").minute).toBe(6 * 60);
    expect(localClock(at("2026-10-12T10:00:00Z"), "Not/AZone")).toEqual({ day: 1, minute: 600 });
  });

  it("nextLocalTime lands on the next 07:00 in that zone", () => {
    expect(nextLocalTime(at("2026-10-12T23:30:00Z"), "UTC", 7)).toBe("2026-10-13T07:00:00.000Z");
    expect(nextLocalTime(at("2026-10-12T05:00:00Z"), "UTC", 7)).toBe("2026-10-12T07:00:00.000Z");
  });
});

describe("effective presence", () => {
  const now = at("2026-10-12T12:00:00Z");

  it("an expired custom status and an expired focus drop out on read, with no job to clear them", () => {
    const e = effectivePresence(row({ customText: "Traveling", customUntil: "2026-10-12T11:00:00Z", focusMode: "work", focusUntil: "2026-10-12T11:59:00Z" }), [], now);
    expect(e.customText).toBeNull();
    expect(e.focus).toBeNull();
  });

  it("a chosen focus wins over a schedule, and a schedule fills in when nothing was chosen", () => {
    const work = sched({ mode: "work", startMin: 9 * 60, endMin: 17 * 60 });
    expect(effectivePresence(row({ focusMode: "study" }), [work], now).focus).toEqual({ mode: "study", source: "manual", until: null });
    expect(effectivePresence(row(), [work], now).focus).toEqual({ mode: "work", source: "schedule", until: null });
  });

  it("pushes wait for Do Not Disturb and for the focus modes that hold them, not for Work", () => {
    expect(effectivePresence(row({ status: "dnd" }), [], now).holdsPush).toBe(true);
    expect(effectivePresence(row({ focusMode: "sleep" }), [], now).holdsPush).toBe(true);
    expect(effectivePresence(row({ focusMode: "work" }), [], now).holdsPush).toBe(false);
  });

  it("an auto reply answers only while the member is actually away from chat", () => {
    expect(effectivePresence(row({ autoReply: "Later" }), [], now).autoReply).toBeNull();
    expect(effectivePresence(row({ autoReply: "Later", focusMode: "meeting" }), [], now).autoReply).toBe("Later");
  });

  it("drops unknown open-to values instead of showing them", () => {
    expect(effectivePresence(row({ openTo: ["chat", "<script>"] }), [], now).openTo).toEqual(["chat"]);
  });
});

describe("what other people see", () => {
  it("focus first, then the custom status, then a manual status, never a number", () => {
    expect(presenceLine({ status: "busy", focus: { mode: "sleep", source: "manual", until: null }, customText: "x" })).toBe("Sleeping");
    expect(presenceLine({ status: "busy", focus: null, customText: "Traveling" })).toBe("Traveling");
    expect(presenceLine({ status: "available", focus: null, customText: null })).toBeNull();
    for (const m of FOCUS_MODES) expect(FOCUS_SPECS[m].shownAs).not.toMatch(/\d|%/);
  });

  it("the audience gate: nobody hides it from friends, a circle needs membership, the owner always sees", () => {
    expect(audienceAllows("nobody", { self: false, friend: true, inCircle: true })).toBe(false);
    expect(audienceAllows("friends", { self: false, friend: false, inCircle: false })).toBe(false);
    expect(audienceAllows("circle", { self: false, friend: true, inCircle: false })).toBe(false);
    expect(audienceAllows("circle", { self: false, friend: false, inCircle: true })).toBe(true);
    expect(audienceAllows("nobody", { self: true, friend: false, inCircle: false })).toBe(true);
  });
});

describe("Smart Availability suggests, and never more than two", () => {
  const plain = effectivePresence(row(), [], at("2026-10-12T12:00:00Z"));
  it("late at night it offers Sleep, and not when a focus is already on", () => {
    expect(smartSuggestions({ day: 1, minute: 23 * 60, effective: plain, schedules: [] }).map((s) => s.id)).toContain("sleep_now");
    const sleeping = { ...plain, focus: { mode: "sleep" as const, source: "manual" as const, until: null } };
    expect(smartSuggestions({ day: 1, minute: 23 * 60, effective: sleeping, schedules: [] }).map((s) => s.id)).not.toContain("sleep_now");
  });

  it("offers working hours on a weekday afternoon only when none exist", () => {
    expect(smartSuggestions({ day: 2, minute: 14 * 60, effective: plain, schedules: [] }).map((s) => s.id)).toEqual(["work_schedule"]);
    expect(smartSuggestions({ day: 2, minute: 14 * 60, effective: plain, schedules: [sched({ mode: "work" })] })).toEqual([]);
    expect(smartSuggestions({ day: 6, minute: 14 * 60, effective: plain, schedules: [] })).toEqual([]);
  });
});
