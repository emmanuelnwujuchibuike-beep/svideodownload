import { describe, expect, it } from "vitest";

import { FLAGS } from "@/lib/platform/flags";

import { MAX_RESTORES, REMINDER_HOUR, RESTORE_WINDOW_DAYS } from "./types";

/**
 * Guards on the streak system's configuration — the assumptions other files
 * make about it, written down where they will fail loudly.
 */

describe("streak flags", () => {
  const streakFlags = FLAGS.filter((f) => f.id.startsWith("streak"));

  it("declares both switches the brief asks for", () => {
    expect(streakFlags.map((f) => f.id).sort()).toEqual(["streak-notifications", "streak-system"]);
  });

  it("ships ON, so the feature is live and the flag is a kill switch", () => {
    for (const flag of streakFlags) expect(flag.defaultEnabled, flag.id).toBe(true);
  });

  it("gates notifications behind the system flag", () => {
    const notifications = streakFlags.find((f) => f.id === "streak-notifications");
    expect(notifications?.requires).toBe("streak-system");
  });

  it("🔴 is neither plan-gated nor admin-bypassed", () => {
    /*
      lib/streaks/request.ts resolves these flags with `plan: "free"` and
      `isAdmin: false` rather than looking either up — deliberately, because
      that path runs on every page open for every visitor and two extra database
      round trips there would be the most expensive thing in the feature.
      Both values are inert inside `resolveFlag` while this holds. If someone
      plan-gates a streak flag, this fails and points at the code to fix.
    */
    for (const flag of streakFlags) {
      expect(flag.plans, `${flag.id} declares plans — wire the real plan in lib/streaks/request.ts`).toBeUndefined();
      expect(flag.adminBypass, `${flag.id} declares adminBypass — wire the real admin flag in lib/streaks/request.ts`).toBeUndefined();
    }
  });

  it("keeps streak flags server-only", () => {
    // Nothing reads them from the client: the API returns a neutral state when
    // off, so the UI needs no second flag round trip on the landing page.
    for (const flag of streakFlags) expect(flag.clientReadable).toBeFalsy();
  });
});

describe("streak constants", () => {
  it("matches the brief's stated policy", () => {
    expect(RESTORE_WINDOW_DAYS).toBe(3); // "3-calendar-day restoration window"
    expect(REMINDER_HOUR).toBe(14); // "by 2:00 PM in their local timezone"
    expect(MAX_RESTORES).toBeGreaterThan(0); // "do not allow unlimited restoration abuse"
  });
});
