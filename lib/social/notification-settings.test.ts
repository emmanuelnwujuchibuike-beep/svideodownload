import { describe, expect, it } from "vitest";

import {
  computeShouldPush,
  computeShouldShowInApp,
  DEFAULT_NOTIFICATION_SETTINGS,
  isWithinQuietHours,
  mutedTypesFor,
  type NotificationSettings,
} from "./notification-settings";

const settings = (patch: Partial<NotificationSettings> = {}): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS,
  ...patch,
});

describe("isWithinQuietHours", () => {
  it("handles a same-day window", () => {
    expect(isWithinQuietHours(13, 9, 17)).toBe(true);
    expect(isWithinQuietHours(8, 9, 17)).toBe(false);
    expect(isWithinQuietHours(17, 9, 17)).toBe(false); // end is exclusive
  });

  it("handles a window that wraps past midnight", () => {
    expect(isWithinQuietHours(23, 22, 8)).toBe(true);
    expect(isWithinQuietHours(3, 22, 8)).toBe(true);
    expect(isWithinQuietHours(12, 22, 8)).toBe(false);
  });

  it("treats a zero-width window as never active", () => {
    expect(isWithinQuietHours(10, 10, 10)).toBe(false);
  });
});

describe("computeShouldPush", () => {
  it("blocks everything when the master switch is off", () => {
    expect(computeShouldPush(settings({ masterEnabled: false }), "social", 12)).toBe(false);
  });

  it("blocks everything when the push channel is off", () => {
    expect(computeShouldPush(settings({ pushEnabled: false }), "social", 12)).toBe(false);
  });

  it("respects a per-category push toggle", () => {
    const s = settings({ categoryPrefs: { social: { enabled: true, push: false } } });
    expect(computeShouldPush(s, "social", 12)).toBe(false);
  });

  it("respects a per-category enabled toggle even if push is left true", () => {
    const s = settings({ categoryPrefs: { social: { enabled: false, push: true } } });
    expect(computeShouldPush(s, "social", 12)).toBe(false);
  });

  it("defaults an unconfigured category to enabled+push", () => {
    expect(computeShouldPush(settings(), "downloads", 12)).toBe(true);
  });

  it("holds back push during quiet hours", () => {
    const s = settings({ quietHoursEnabled: true, quietHoursStartUtc: 22, quietHoursEndUtc: 8 });
    expect(computeShouldPush(s, "social", 2)).toBe(false); // 2am — inside the window
    expect(computeShouldPush(s, "social", 14)).toBe(true); // 2pm — outside the window
  });

  it("security notifications are NEVER held back by quiet hours, even if somehow disabled", () => {
    const s = settings({ quietHoursEnabled: true, quietHoursStartUtc: 0, quietHoursEndUtc: 23 });
    expect(computeShouldPush(s, "security", 5)).toBe(true);
  });

  it("a category marked alwaysDeliver bypasses quiet hours", () => {
    const s = settings({
      quietHoursEnabled: true,
      quietHoursStartUtc: 0,
      quietHoursEndUtc: 23,
      categoryPrefs: { downloads: { enabled: true, push: true, alwaysDeliver: true } },
    });
    expect(computeShouldPush(s, "downloads", 5)).toBe(true);
  });
});

describe("computeShouldShowInApp", () => {
  it("blocks everything when the master switch is off", () => {
    expect(computeShouldShowInApp(settings({ masterEnabled: false }), "social")).toBe(false);
  });

  it("blocks everything when the in-app channel is off", () => {
    expect(computeShouldShowInApp(settings({ inAppEnabled: false }), "social")).toBe(false);
  });

  it("respects a per-category enabled toggle, independent of quiet hours", () => {
    const s = settings({ categoryPrefs: { news: { enabled: false, push: true } }, quietHoursEnabled: true });
    expect(computeShouldShowInApp(s, "news")).toBe(false);
  });

  it("defaults an unconfigured category to visible", () => {
    expect(computeShouldShowInApp(settings(), "community")).toBe(true);
  });
});

describe("mutedTypesFor", () => {
  it("returns only the types whose category is muted", () => {
    const s = settings({ categoryPrefs: { downloads: { enabled: false, push: false } } });
    const categoryByType = { download_complete: "downloads", follow: "social" } as const;
    expect(mutedTypesFor(s, categoryByType)).toEqual(["download_complete"]);
  });

  it("returns an empty list when nothing is muted", () => {
    const categoryByType = { follow: "social", like: "social" } as const;
    expect(mutedTypesFor(settings(), categoryByType)).toEqual([]);
  });
});
