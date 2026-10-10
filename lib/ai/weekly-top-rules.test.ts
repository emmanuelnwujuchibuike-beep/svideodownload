import { describe, expect, it } from "vitest";

import { rankSpenders, spendByUser, weekBounds, weeklyAwards, weekStartOf } from "./weekly-top-rules";

describe("weekly top AI creators (owner, 2026-10-10)", () => {
  it("a week starts on Monday, UTC", () => {
    expect(weekStartOf(Date.parse("2026-10-10T12:00:00Z"))).toBe("2026-10-05"); // a Saturday
    expect(weekStartOf(Date.parse("2026-10-05T00:00:00Z"))).toBe("2026-10-05"); // Monday midnight
    expect(weekStartOf(Date.parse("2026-10-04T23:59:59Z"))).toBe("2026-09-28"); // Sunday night
    expect(weekBounds("2026-10-05")).toEqual({ start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z" });
  });

  it("spend is charges minus refunds, per person", () => {
    const s = spendByUser([
      { user_id: "a", delta_cents: -300 },
      { user_id: "a", delta_cents: -400 },
      { user_id: "a", delta_cents: 100 }, // a refunded job
      { user_id: "b", delta_cents: -50 },
      { user_id: "c", delta_cents: 20 }, // only a refund: no spend
    ]);
    expect(Object.fromEntries(s)).toEqual({ a: 600, b: 50 });
  });

  it("first, second and third get 50, 30 and 20 when each spent more than 500", () => {
    const ranked = rankSpenders(new Map([["a", 900], ["b", 700], ["c", 600], ["d", 550]]));
    expect(weeklyAwards(ranked)).toEqual([
      { rank: 1, userId: "a", spent: 900, credits: 50 },
      { rank: 2, userId: "b", spent: 700, credits: 30 },
      { rank: 3, userId: "c", spent: 600, credits: 20 },
    ]);
  });

  it("teeth: a rank whose spend is 500 or less is not paid, and a quiet week pays nobody", () => {
    expect(weeklyAwards(rankSpenders(new Map([["a", 900], ["b", 500], ["c", 400]])))).toEqual([{ rank: 1, userId: "a", spent: 900, credits: 50 }]);
    expect(weeklyAwards(rankSpenders(new Map([["a", 500]])))).toEqual([]);
  });

  it("the top list is ordered, capped and stable on ties", () => {
    const ranked = rankSpenders(new Map(Array.from({ length: 15 }, (_, i) => [`u${String(i).padStart(2, "0")}`, 100] as const)), 10);
    expect(ranked).toHaveLength(10);
    expect(ranked[0]!.userId).toBe("u00");
  });
});
