import { describe, expect, it } from "vitest";

import { anniversaryDate, buildTimeline, upcomingAnniversary, yearsBetween } from "@/lib/social/graph/milestones";

const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("anniversaryDate", () => {
  it("keeps the same calendar day", () => {
    expect(anniversaryDate(at("2023-06-15"), 2026).toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  // The case a naive setUTCFullYear gets wrong: 29 Feb rolls to 1 March.
  it("pins a leap-day anniversary to 28 February in non-leap years", () => {
    expect(anniversaryDate(at("2024-02-29"), 2025).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(anniversaryDate(at("2024-02-29"), 2026).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("keeps 29 February in a leap year", () => {
    expect(anniversaryDate(at("2024-02-29"), 2028).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("treats 2100 as the non-leap year it is", () => {
    expect(anniversaryDate(at("2024-02-29"), 2100).toISOString().slice(0, 10)).toBe("2100-02-28");
    expect(anniversaryDate(at("2024-02-29"), 2000).toISOString().slice(0, 10)).toBe("2000-02-29");
  });
});

describe("yearsBetween", () => {
  it("counts only whole years", () => {
    expect(yearsBetween(at("2020-06-15"), at("2026-06-14"))).toBe(5);
    expect(yearsBetween(at("2020-06-15"), at("2026-06-15"))).toBe(6);
  });

  it("never goes negative for a future date", () => {
    expect(yearsBetween(at("2030-01-01"), at("2026-01-01"))).toBe(0);
  });
});

describe("upcomingAnniversary", () => {
  it("finds one inside the window", () => {
    const result = upcomingAnniversary("2023-08-20T10:00:00.000Z", at("2026-08-04"));
    expect(result).toEqual({ years: 3, date: "2026-08-20", daysAway: 16 });
  });

  it("reports zero days away on the day itself", () => {
    expect(upcomingAnniversary("2023-08-04T10:00:00.000Z", at("2026-08-04"))?.daysAway).toBe(0);
  });

  it("rolls into next year once this year's has passed", () => {
    const result = upcomingAnniversary("2020-01-10T00:00:00.000Z", at("2026-12-20"), 60);
    expect(result?.date).toBe("2027-01-10");
    expect(result?.years).toBe(7);
  });

  it("returns nothing outside the window", () => {
    expect(upcomingAnniversary("2023-08-20T00:00:00.000Z", at("2026-01-04"))).toBeNull();
  });

  // "Friends for 0 years" is not an occasion.
  it("returns nothing before the first full year", () => {
    expect(upcomingAnniversary("2026-07-01T00:00:00.000Z", at("2026-07-10"))).toBeNull();
  });

  it("returns nothing for a missing or unparseable date", () => {
    expect(upcomingAnniversary(null, at("2026-08-04"))).toBeNull();
    expect(upcomingAnniversary("not a date", at("2026-08-04"))).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("derives every entry from a real timestamp, oldest first", () => {
    const timeline = buildTimeline(
      {
        friendsSince: "2024-03-01T12:00:00.000Z",
        followingSince: "2023-11-05T09:00:00.000Z",
        firstMessageAt: "2024-03-02T08:30:00.000Z",
      },
      at("2026-08-04"),
    );
    expect(timeline.map((m) => m.kind)).toEqual([
      "following_since",
      "friends_since",
      "first_message",
      "anniversary",
      "anniversary",
    ]);
    expect(timeline[0]!.at).toBe("2023-11-05");
  });

  it("adds one anniversary per completed year", () => {
    const timeline = buildTimeline({ friendsSince: "2020-01-01T00:00:00.000Z" }, at("2026-08-04"));
    const anniversaries = timeline.filter((m) => m.kind === "anniversary");
    expect(anniversaries).toHaveLength(6);
    expect(anniversaries.at(-1)!.years).toBe(6);
    expect(anniversaries.at(-1)!.title).toBe("6 years");
    expect(anniversaries[0]!.title).toBe("1 year");
  });

  it("adds no anniversary inside the first year", () => {
    const timeline = buildTimeline({ friendsSince: "2026-05-01T00:00:00.000Z" }, at("2026-08-04"));
    expect(timeline.filter((m) => m.kind === "anniversary")).toHaveLength(0);
  });

  it("is empty when nothing is known — it never invents a milestone", () => {
    expect(buildTimeline({}, at("2026-08-04"))).toEqual([]);
    expect(buildTimeline({ friendsSince: null, followingSince: null, firstMessageAt: null }, at("2026-08-04"))).toEqual(
      [],
    );
  });

  it("hangs anniversaries off the follow when there is no friendship", () => {
    const timeline = buildTimeline({ followingSince: "2024-02-01T00:00:00.000Z" }, at("2026-08-04"));
    expect(timeline.filter((m) => m.kind === "anniversary")).toHaveLength(2);
  });
});
