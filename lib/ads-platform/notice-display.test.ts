import { describe, expect, it } from "vitest";

import { noticeAsDisplayed } from "./notice-display";

/** Owner 2026-10-14: the push's view counts must match the dashboard's x10 sample mode. */
describe("noticeAsDisplayed", () => {
  it("🔴 views to go match the dashboard (delivered x10, capped at the target)", () => {
    // 1,000 bought, 60 really delivered: the dashboard shows 600 delivered, so 400 to go (not 940)
    expect(noticeAsDisplayed({ kind: "deadline_soon", remaining: 940, endAt: null, freeExtension: true }, 1000, 10)).toMatchObject({ remaining: 400 });
    expect(noticeAsDisplayed({ kind: "delivery_extended", remaining: 940, endAt: null }, 1000, 10)).toMatchObject({ remaining: 400 });
    expect(noticeAsDisplayed({ kind: "delivery_shortfall", shortfall: 940, refundOwed: true }, 1000, 10)).toMatchObject({ shortfall: 400 });
  });

  it("no '0 views to go' notice when the dashboard already shows the target met", () => {
    expect(noticeAsDisplayed({ kind: "deadline_soon", remaining: 850, endAt: null, freeExtension: false }, 1000, 10)).toBeNull();
  });

  it("a refund notice always goes", () => {
    expect(noticeAsDisplayed({ kind: "delivery_shortfall", shortfall: 850, refundOwed: true }, 1000, 10)).toMatchObject({ shortfall: 850 });
  });

  it("unchanged without the sample mode, or without a target", () => {
    const n = { kind: "deadline_soon", remaining: 940, endAt: null, freeExtension: true } as const;
    expect(noticeAsDisplayed(n, 1000, 1)).toBe(n);
    expect(noticeAsDisplayed(n, null, 10)).toBe(n);
  });
});
