import { describe, expect, it } from "vitest";

import {
  WALLPAPER_DAILY_LIMITS,
  WALLPAPER_REWARD_SECONDS,
  wallpaperDailyLimit,
  wallpaperLimitMessage,
  wallpaperNeedsReward,
} from "./wallpapers-limits";

describe("wallpaper daily limits", () => {
  it("caps free at five a day", () => {
    // The number exists to keep rewarded-ad volume inside policy, so it is the
    // one value here worth asserting literally.
    expect(wallpaperDailyLimit("free")).toBe(5);
  });

  it("does not cap a paying member", () => {
    // 0 means no cap — they have paid for the thing the ad funds.
    expect(wallpaperDailyLimit("pro")).toBe(0);
    expect(wallpaperDailyLimit("business")).toBe(0);
  });

  it("shows the ad exactly where there is a cap", () => {
    // These two must never disagree: an uncapped plan watching ads, or a capped
    // plan downloading free, are both bugs that only show up in production.
    for (const plan of ["free", "pro", "business"] as const) {
      expect(wallpaperNeedsReward(plan)).toBe(WALLPAPER_DAILY_LIMITS[plan] > 0);
    }
  });

  it("treats an unknown plan as free rather than unlimited", () => {
    // Fail closed: a plan string we don't recognise must not hand out the
    // uncapped tier.
    expect(wallpaperDailyLimit("enterprise" as never)).toBe(5);
  });

  it("rewards for a full 30 seconds", () => {
    expect(WALLPAPER_REWARD_SECONDS).toBe(30);
  });

  it("says when the limit lifts and what the alternative is", () => {
    const msg = wallpaperLimitMessage(5);
    expect(msg).toContain("5");
    expect(msg).toMatch(/midnight/i);
    expect(msg).toMatch(/pro/i);
  });
});
