import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeReach, MIN_VIEWS } from "./reach";

/** A stand-in for the head-count queries: page views by path. */
function db(views: Record<string, number>) {
  const total = Object.values(views).reduce((a, b) => a + b, 0);
  return {
    from: () => {
      let paths: string[] | null = null;
      let prefix: string | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        in: (_c: string, p: string[]) => ((paths = p), q),
        like: (_c: string, p: string) => ((prefix = p.replace(/%$/, "")), q),
        then: (res: (v: { count: number }) => void) => {
          const count = paths
            ? paths.reduce((n, p) => n + (views[p] ?? 0), 0)
            : prefix
              ? Object.entries(views).filter(([p]) => p.startsWith(prefix!)).reduce((n, [, v]) => n + v, 0)
              : total;
          res({ count });
        },
      };
      return q;
    },
  } as never;
}

const placements = [
  { code: "global_top_banner", page_scope: ["all_pages"] },
  { code: "all_slots", page_scope: ["all_pages"] },
  { code: "download_page_banner", page_scope: ["download"] },
  { code: "download_completed_interstitial", page_scope: ["download", "download_result"] },
  { code: "feed_banner", page_scope: ["feed"] },
  { code: "history_grid", page_scope: ["history"] },
];

describe("measured reach (never invented)", () => {
  it("each placement's share of visits; every-page placements and All slots are 100 %", async () => {
    const r = await computeReach(db({ "/": 300, "/downloads": 150, "/history": 100, "/feed": 30, "/feed/x": 20, "/messages": 400 }), placements);
    expect(r.placements).toEqual({
      global_top_banner: 100,
      all_slots: 100,
      download_page_banner: 45, // 450 / 1000
      download_completed_interstitial: 45, // the same pages counted ONCE, not twice
      feed_banner: 5, // /feed + /feed/x
      history_grid: 10,
    });
  });

  it("teeth: below the minimum sample there is no percentage at all", async () => {
    const r = await computeReach(db({ "/": MIN_VIEWS - 1 }), placements);
    expect(r.placements).toBeNull();
  });
});
