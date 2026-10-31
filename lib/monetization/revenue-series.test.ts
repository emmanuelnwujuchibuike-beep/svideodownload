import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { fullyReadFrom } from "./revenue-series";

const scan = (capped: boolean, ...days: string[]) => ({
  capped,
  rows: days.map((d) => ({ created_at: `${d}T12:00:00.000Z` })),
});

describe("fullyReadFrom — which days a capped revenue scan really covers", () => {
  it("is null when no scan hit the cap", () => {
    expect(fullyReadFrom([scan(false, "2026-10-30", "2026-05-01")])).toBeNull();
  });

  it("starts the day AFTER a capped scan's oldest row (that day may be cut mid-way)", () => {
    expect(fullyReadFrom([scan(true, "2026-10-30", "2026-07-15")])).toBe("2026-07-16");
  });

  it("takes the latest cut-off across capped scans and ignores uncapped ones", () => {
    expect(
      fullyReadFrom([scan(true, "2026-10-30", "2026-06-01"), scan(true, "2026-10-30", "2026-09-10"), scan(false, "2026-01-01")]),
    ).toBe("2026-09-11");
  });

  // Teeth: the owner's 2026-10-30 report. A cap inside the hidden comparison
  // half must NOT flag the visible window; one inside it must.
  it("flags the visible window only when the cut-off lands inside it", () => {
    const visibleStart = "2026-08-02";
    const capOnlyInBaseline = fullyReadFrom([scan(true, "2026-10-30", "2026-06-20")]);
    const capInsideWindow = fullyReadFrom([scan(true, "2026-10-30", "2026-09-01")]);
    expect(capOnlyInBaseline !== null && capOnlyInBaseline > visibleStart).toBe(false);
    expect(capInsideWindow !== null && capInsideWindow > visibleStart).toBe(true);
  });
});
