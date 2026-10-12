import { describe, expect, it } from "vitest";

import { capMatters, decideDelivery, explainDelivery, type AttentionInput, quietHourNow } from "@/lib/notifications/attention";
import { summarizeHeld, summaryTitle } from "@/lib/notifications/held-summary";
import { DEFAULT_NOTIFICATION_SETTINGS, zoneHourToUtc, type NotificationSettings } from "@/lib/social/notification-settings";

/*
  Feature 20 — the Attention Engine. The first block pins the rules sendSmartPush
  ALREADY had (Parts 4–8, owner 2026-07-16 "DND is absolute"), so lifting them out
  changed nothing; the second pins what is new.
*/
const settings = (p: Partial<NotificationSettings> = {}): NotificationSettings => ({ ...DEFAULT_NOTIFICATION_SETTINGS, ...p });
const free = { holds: false } as const;
const base = (p: Partial<AttentionInput> = {}): AttentionInput => ({ priority: "medium", category: "social", settings: settings(), hold: free, quietHour: 12, favorite: false, overCap: false, ...p });
const quiet = settings({ quietHoursEnabled: true, quietHoursStartUtc: 22, quietHoursEndUtc: 8 });

describe("unchanged rules", () => {
  it("critical always pushes — through DND, a focus mode, master off", () => {
    for (const s of [settings({ masterEnabled: false }), settings({ pushEnabled: false }), quiet]) {
      expect(decideDelivery(base({ priority: "critical", settings: s, hold: { holds: true, dnd: true, focus: null }, quietHour: 23 })).decision).toBe("push");
    }
  });

  it("DND and holding focus modes hold EVERYTHING else, high included (owner 2026-07-16)", () => {
    for (const priority of ["high", "medium", "low"] as const) {
      expect(decideDelivery(base({ priority, hold: { holds: true, dnd: true, focus: null } }))).toEqual({ decision: "held", reasons: ["dnd"] });
      expect(decideDelivery(base({ priority, hold: { holds: true, dnd: false, focus: "sleep" } }))).toEqual({ decision: "held", reasons: ["focus:sleep"] });
    }
  });

  it("high obeys the switches but not quiet hours", () => {
    expect(decideDelivery(base({ priority: "high", settings: quiet, quietHour: 23 })).decision).toBe("push");
    expect(decideDelivery(base({ priority: "high", settings: settings({ pushEnabled: false }) })).decision).toBe("in_app");
    expect(decideDelivery(base({ priority: "high", settings: settings({ categoryPrefs: { social: { enabled: true, push: false } } }) })).decision).toBe("in_app");
  });

  it("medium/low are held by quiet hours, which wrap past midnight", () => {
    expect(decideDelivery(base({ settings: quiet, quietHour: 23 }))).toEqual({ decision: "held", reasons: ["quiet_hours"] });
    expect(decideDelivery(base({ settings: quiet, quietHour: 3 })).decision).toBe("held");
    expect(decideDelivery(base({ settings: quiet, quietHour: 12 })).decision).toBe("push");
  });

  it("security-category and alwaysDeliver pass quiet hours; the burst cap still applies to them", () => {
    expect(decideDelivery(base({ category: "security", settings: quiet, quietHour: 23 })).decision).toBe("push");
    const always = settings({ ...quiet, categoryPrefs: { social: { enabled: true, push: true, alwaysDeliver: true } } });
    expect(decideDelivery(base({ settings: always, quietHour: 23 })).decision).toBe("push");
    expect(decideDelivery(base({ settings: always, quietHour: 23, overCap: true }))).toEqual({ decision: "in_app", reasons: ["burst_cap"] });
  });

  it("the burst cap only ever matters for medium/low that are not held", () => {
    expect(capMatters("high", free)).toBe(false);
    expect(capMatters("critical", free)).toBe(false);
    expect(capMatters("low", { holds: true, dnd: true, focus: null })).toBe(false);
    expect(capMatters("medium", free)).toBe(true);
    expect(decideDelivery(base({ priority: "high", overCap: true })).decision).toBe("push");
  });
});

describe("Part 5: delivery rules", () => {
  it("a rule never beats DND or a focus mode, or the member's own off switches", () => {
    expect(decideDelivery(base({ rule: "immediate", hold: { holds: true, dnd: true, focus: null } })).decision).toBe("held");
    expect(decideDelivery(base({ rule: "immediate", settings: settings({ pushEnabled: false }) })).decision).toBe("in_app");
  });
  it("immediate pushes through quiet hours; summary holds; in_app keeps it in the app", () => {
    expect(decideDelivery(base({ rule: "immediate", settings: quiet, quietHour: 23 }))).toEqual({ decision: "push", reasons: ["rule_immediate"] });
    expect(decideDelivery(base({ rule: "summary" }))).toEqual({ decision: "held", reasons: ["rule_summary"] });
    expect(decideDelivery(base({ rule: "in_app", priority: "high" }))).toEqual({ decision: "in_app", reasons: ["rule_in_app"] });
  });
  it("critical is untouched by any rule (teeth)", () => {
    expect(decideDelivery(base({ priority: "critical", rule: "in_app" })).decision).toBe("push");
  });
});

describe("new in Feature 20", () => {
  it("a favourite gets through quiet hours ONLY when the member allows it", () => {
    expect(decideDelivery(base({ settings: quiet, quietHour: 23, favorite: true })).decision).toBe("held");
    const allow = settings({ ...quiet, favoritesBypassQuiet: true });
    expect(decideDelivery(base({ settings: allow, quietHour: 23, favorite: true }))).toEqual({ decision: "push", reasons: ["favorite_through_quiet"] });
    expect(decideDelivery(base({ settings: allow, quietHour: 23, favorite: false })).decision).toBe("held");
  });

  it("a favourite never gets through DND or a focus mode (teeth: the bypass is checked after the hold)", () => {
    const allow = settings({ ...quiet, favoritesBypassQuiet: true });
    expect(decideDelivery(base({ settings: allow, quietHour: 23, favorite: true, hold: { holds: true, dnd: true, focus: null } })).decision).toBe("held");
  });

  it("quiet hours are read in the member's zone once saved, UTC before", () => {
    const at = new Date("2026-10-12T21:30:00Z");
    expect(quietHourNow(at, null)).toBe(21);
    expect(quietHourNow(at, "Africa/Lagos")).toBe(22);
    expect(quietHourNow(at, "America/Los_Angeles")).toBe(14);
    expect(quietHourNow(at, "Not/AZone")).toBe(21);
  });

  it("zoneHourToUtc turns a member's clock hour into UTC, across midnight too", () => {
    const at = new Date("2026-10-12T23:30:00Z"); // 00:30 next day in Lagos
    expect(zoneHourToUtc(22, "Africa/Lagos", at)).toBe(21);
    expect(zoneHourToUtc(8, "Africa/Lagos", at)).toBe(7);
    expect(zoneHourToUtc(22, "America/Los_Angeles", at)).toBe(5);
  });

  it("every decision can be said in a sentence, privately", () => {
    expect(explainDelivery("held", ["focus:sleep"])).toMatch(/Sleep focus was on/);
    expect(explainDelivery("held", ["quiet_hours"])).toMatch(/quiet hours/);
    expect(explainDelivery("push", ["critical"])).toMatch(/always reach you/);
    expect(explainDelivery("in_app", ["burst_cap"])).toMatch(/last hour/);
    expect(explainDelivery(null, [])).not.toMatch(/push was sent|sent to your devices/i);
  });
});

describe("the held summary", () => {
  it("counts only high and medium: likes and follows are never summarised", () => {
    expect(summarizeHeld(["like", "follow", "like"])).toBeNull();
    expect(summarizeHeld(["message", "message", "comment", "like", "friend_request"])).toBe("2 messages, 1 comment and 1 friend request");
  });

  it("titles itself from the most common hold", () => {
    expect(summaryTitle(["focus:sleep", "focus:sleep", "quiet_hours"])).toBe("While Sleep focus was on");
    expect(summaryTitle(["quiet_hours"])).toBe("While quiet hours were on");
    expect(summaryTitle(["dnd"])).toBe("While Do Not Disturb was on");
    expect(summaryTitle([null])).toBe("While you were away");
  });
});
