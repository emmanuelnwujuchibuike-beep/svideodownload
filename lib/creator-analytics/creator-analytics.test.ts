import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

import { bucket, changePct, coins, compact, pct, signed, usd } from "./format";

/**
 * The rebuilt Creator analytics. The aggregates themselves are pinned against the real SQL in
 * supabase/tests/0297_creator_analytics.pglite.mjs; these pin the formatting rules from the brief, the pure helpers,
 * that the API serves only the signed-in Business creator's own data, and that the screens fake nothing.
 */

describe("number formatting (brief §5)", () => {
  it("compact: 1,300 → 1.3K, 907,000 → 907K, never '1.0K'", () => {
    expect(compact(1300)).toBe("1.3K");
    expect(compact(907_000)).toBe("907K");
    expect(compact(1000)).toBe("1K");
    expect(compact(999)).toBe("999");
    expect(compact(2_450_000)).toBe("2.5M");
    expect(compact(null)).toBe("—");
  });
  it("coins with thousands separators from minor units; USD", () => {
    expect(coins(836_000)).toBe("8,360");
    expect(usd(1240)).toBe("$12.40");
    expect(usd(5000)).toBe("$50");
  });
  it("percentages to one decimal; changes always signed; no change without a baseline", () => {
    expect(pct(4.2345)).toBe("4.2%");
    expect(pct(20)).toBe("20%");
    expect(signed(12.44)).toBe("+12.4%");
    expect(signed(-3)).toBe("−3%");
    expect(signed(0)).toBe("0%");
    expect(changePct(120, 100)).toBeCloseTo(20);
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(5, null)).toBeNull();
  });
  it("bucket groups a daily series into at most n sums, keeping the first day as the label", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, v: 1 }));
    expect(bucket(rows, 2, (r) => r.v)).toEqual([{ day: "2026-10-01", value: 7 }, { day: "2026-10-08", value: 7 }]);
  });
});

describe("pure helpers", async () => {
  vi.mock("server-only", () => ({}));
  const server = await import("./server");
  it("weeks sums the last n 7-day weeks, oldest first", () => {
    expect(server.weeks(Array(14).fill(1), 8)).toEqual([7, 7]);
    expect(server.weeks([1, 2, 3, 4, 5, 6, 7, 8], 8)).toEqual([1, 35]);
  });
  it("best time to post: only with enough views (≥ 50) and a real peak — never a guess", () => {
    expect(server.bestTime(null)).toBeNull();
    expect(server.bestTime([{ dow: 0, block: 5, count: 10 }])).toBeNull();
    const even = Array.from({ length: 42 }, (_, i) => ({ dow: Math.floor(i / 6), block: i % 6, count: 2 }));
    expect(server.bestTime(even)).toBeNull();
    const peaked = [...even.slice(1), { dow: 0, block: 0, count: 40 }];
    expect(server.bestTime(peaked)).toMatchObject({ dow: 0, block: 0 });
  });
});

let db: FakeDb;
let sessionUser: { id: string } | null = null;
let plan = "business";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/monetization/plan", () => ({ getUserPlan: async () => plan }));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));

describe("GET /api/creator-analytics/:section", async () => {
  const route = await import("@/app/api/creator-analytics/[section]/route");
  const ME = "00000000-0000-4000-8000-000000000001";
  const OTHER = "00000000-0000-4000-8000-000000000002";
  const call = (section: string, qs = "") => route.GET(new Request(`https://frenzsave.com/api/creator-analytics/${section}?${qs}`), { params: Promise.resolve({ section }) });
  let calls: { fn: string; args: Record<string, unknown> }[];
  beforeEach(() => {
    sessionUser = { id: ME };
    plan = "business";
    calls = [];
    db = fakeDb({ profiles: [{ id: ME, followers_count: 10 }], posts: [{ id: "p1", publisher_id: OTHER, title: "Not mine", views_count: 5, status: "published" }], gift_sends: [], sub_posts: [], sub_preview_events: [], ai_jobs: [] });
    for (const fn of ["creator_daily_metrics", "creator_view_sources", "creator_heatmap", "creator_locations", "creator_top_engaging", "creator_unique_viewers", "creator_post_curve", "creator_feature_usage", "sub_creator_summary", "sub_creator_daily"])
      db.rpc[fn] = (args) => {
        calls.push({ fn, args });
        return { data: fn === "creator_daily_metrics" || fn === "sub_creator_daily" || fn.endsWith("sources") || fn.endsWith("heatmap") || fn.endsWith("locations") || fn.endsWith("engaging") ? [] : fn === "creator_post_curve" ? null : {}, error: null };
      };
  });
  it("needs a session and the Business plan", async () => {
    sessionUser = null;
    expect((await call("overview")).status).toBe(401);
    sessionUser = { id: ME };
    plan = "free";
    expect((await call("overview")).status).toBe(403);
  });
  it("every aggregate is asked about the SESSION's creator — a creator param in the URL changes nothing", async () => {
    expect((await call("overview", `period=7d&creator=${OTHER}&p_creator=${OTHER}`)).status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.args.p_creator).toBe(ME);
  });
  it("an unknown period falls back to 30 days; a bad time zone to UTC; an unknown section is 404", async () => {
    await call("social", "period=forever&tz=;drop");
    const d = calls.find((c) => c.fn === "creator_daily_metrics")!;
    expect(d.args.p_tz).toBe("UTC");
    expect((await call("everything")).status).toBe(404);
  });
  it("another creator's post: 404, never its numbers", async () => {
    expect((await call("post", "id=00000000-0000-4000-8000-0000000000aa")).status).toBe(404);
    expect((await call("post", "id=not-a-uuid")).status).toBe(400);
  });
  it("answers private, never CDN-cached", async () => {
    expect((await call("overview")).headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("the screens fake nothing", () => {
  const files = ["overview", "social", "money", "insights"].map((f) => readFileSync(`features/creator-analytics/screens/${f}.tsx`, "utf8")).join("\n");
  it("no sample numbers from the design's DATA object are hard-coded", () => {
    for (const sample of ["8,360", "4,280", "907K", "Red Rose", "64%", "+318", "167", "4.2%"]) expect(files, sample).not.toContain(sample);
  });
  it("money keeps its unit: subscriptions as dollars, gifts as Gift Coins — never added together", () => {
    expect(files).not.toMatch(/cents\s*\+\s*[a-z.]*fgc|fgc\s*\+\s*[a-z.]*cents/i);
    expect(files).toContain("Gift Coins");
  });
});
