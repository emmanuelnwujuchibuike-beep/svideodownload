import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { completionRate, learningEngagement, type EngagementRow } from "./learning-analytics";

/*
  The Supabase client is mocked so the degradation paths can be exercised
  without a database. The error CODES below are not invented — PGRST202 was
  observed by calling the unapplied RPC against the real project (HTTP 404,
  "no matches were found in the schema cache").
*/
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

/**
 * Migration 0089 — the aggregate over the personal plane.
 *
 * This function is the one thing in the system that reads across every user's
 * reading history. `0088` forbids that with RLS; `0089` steps around RLS with
 * SECURITY DEFINER in order to do its job. Everything below exists because the
 * gap between "an aggregate" and "a disclosure with a count in front of it" is
 * narrow, and closing it correctly is not self-evident from reading the SQL.
 */

const SQL = readFileSync("supabase/migrations/0089_learning_analytics.sql", "utf8");

describe("migration 0089 — authorization", () => {
  it("checks admin INSIDE the definer function", () => {
    /*
     * The whole security model. SECURITY DEFINER means this runs with the
     * owner's privileges and bypasses 0088's RLS entirely, so a missing check
     * here is not "an admin page shows too much" — it is every signed-in user
     * being able to read everyone's reading history by calling one RPC.
     */
    expect(SQL).toMatch(/security\s+definer/i);
    expect(SQL).toMatch(/if not public\.is_admin\(\) then/);
    expect(SQL).toMatch(/raise exception/i);
  });

  it("raises rather than returning an empty set to an unauthorized caller", () => {
    // An empty result is indistinguishable from "nobody has read anything yet".
    // A security control that cannot be told apart from a normal state is one
    // nobody notices has broken.
    const check = SQL.slice(SQL.indexOf("if not public.is_admin()"));
    expect(check.slice(0, 200)).toMatch(/raise exception 'not authorized'/);
  });

  it("pins search_path so the admin check cannot be shadowed", () => {
    // Without this, a caller with a schema on their search_path could define
    // their own `is_admin()` returning true, and the definer context would run
    // it. The check would pass and the data would leave.
    expect(SQL).toMatch(/set search_path = public/);
  });

  it("revokes the PUBLIC execute grant Postgres adds automatically", () => {
    // Function creation grants EXECUTE to PUBLIC by default. Without the
    // revoke, `anon` can invoke a definer function that reads every row.
    expect(SQL).toMatch(/revoke all on function public\.learning_engagement\(\) from public/);
    expect(SQL).toMatch(/grant execute on function public\.learning_engagement\(\) to authenticated/);
  });
});

describe("migration 0089 — k-anonymity", () => {
  it("suppresses buckets below a hard-coded floor", () => {
    expect(SQL).toMatch(/MIN_COHORT\s+constant\s+int\s*:=\s*(\d+)/);
    const floor = Number(SQL.match(/MIN_COHORT\s+constant\s+int\s*:=\s*(\d+)/)?.[1]);
    expect(floor).toBeGreaterThanOrEqual(5);
    expect(SQL).toMatch(/having count\(distinct i\.user_id\) >= MIN_COHORT/);
  });

  it("takes no threshold argument the caller could lower", () => {
    /*
     * The bug this prevents is authorization by parameter: a
     * `min_readers int default 5` argument is trivially defeated by passing 1.
     * The function must therefore take NO arguments at all.
     */
    const signature = SQL.match(/create or replace function public\.learning_engagement\(([^)]*)\)/);
    expect(signature, "function signature not found").toBeTruthy();
    expect(signature![1]!.trim(), "learning_engagement takes an argument").toBe("");
  });

  it("never returns a user identifier", () => {
    // The returns-table declaration is the contract. If user_id appears here,
    // the aggregate has stopped being an aggregate.
    const returns = SQL.slice(SQL.indexOf("returns table"), SQL.indexOf("language plpgsql"));
    expect(returns).not.toMatch(/user_id/);
    expect(returns).toMatch(/item_slug/);
  });

  it("publishes no unsuppressed grand total", () => {
    /*
     * Suppression is defeated by differencing: publish a total alongside
     * suppressed buckets and the residual is recoverable. 0089 therefore
     * exposes exactly one function. A second one returning totals would need
     * this reasoning redone, so the count is pinned.
     */
    const functions = SQL.match(/create or replace function/g) ?? [];
    expect(functions).toHaveLength(1);
  });

  it("collects no new data", () => {
    // No events table, no second record of the same behaviour on a different
    // retention schedule with its own RLS to get wrong.
    expect(SQL).not.toMatch(/create table/i);
  });
});

describe("migration 0089 — operability", () => {
  it("is idempotent, because these are applied by hand", () => {
    expect(SQL).toMatch(/create or replace function/);
  });
});

describe("learningEngagement — degradation", () => {
  beforeEach(() => rpc.mockReset());

  it("treats an unapplied migration as unavailable, not an error", async () => {
    /*
     * PGRST202 is the code PostgREST actually returns for a function that does
     * not exist — verified against the live project, where the naive guess
     * (42883, Postgres's undefined_function) never reaches the client because
     * PostgREST resolves the function from its schema cache and 404s first.
     *
     * Two migrations were already pending when 0089 was written, so this is the
     * path the admin page is most likely to take.
     */
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await learningEngagement()).toEqual({ available: false, reason: "not-migrated" });
  });

  it("also tolerates the raw Postgres codes", async () => {
    for (const code of ["42883", "42P01"]) {
      rpc.mockResolvedValue({ data: null, error: { code } });
      expect((await learningEngagement()).available, code).toBe(false);
    }
  });

  it("reports the function's own refusal distinctly", async () => {
    // 42501 is what the `raise exception 'not authorized'` in 0089 produces,
    // and what a non-admin caller gets. Distinct from "not migrated" because
    // the operator response is completely different.
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await learningEngagement()).toEqual({ available: false, reason: "not-authorized" });
  });

  it("maps rows without inventing anything", async () => {
    rpc.mockResolvedValue({
      data: [
        { item_kind: "lesson", item_slug: "how-to-save-a-video", readers: 9, completions: 6, bookmarks: 2 },
        { item_kind: "article", item_slug: "when-a-link-will-not-download", readers: 7, completions: 1, bookmarks: 0 },
      ],
      error: null,
    });
    const result = await learningEngagement();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.rows[0]).toEqual({
      itemKind: "lesson",
      itemSlug: "how-to-save-a-video",
      readers: 9,
      completions: 6,
      bookmarks: 2,
    });
    // An unrecognised kind falls back to "lesson" rather than widening the union.
    expect(result.rows[1]!.itemKind).toBe("article");
  });

  it("returns an empty set rather than null when there is simply no data", async () => {
    // Distinct from unavailable: the aggregate ran and everything was
    // suppressed. The admin page says different things for the two.
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await learningEngagement()).toEqual({ available: true, rows: [] });
  });
});

describe("completionRate", () => {
  const row = (readers: number, completions: number): EngagementRow => ({
    itemKind: "lesson",
    itemSlug: "x",
    readers,
    completions,
    bookmarks: 0,
  });

  it("returns a fraction", () => {
    expect(completionRate(row(10, 5))).toBe(0.5);
    expect(completionRate(row(8, 8))).toBe(1);
  });

  it("distinguishes 'nobody opened it' from '0% finished it'", () => {
    // Only one of those is a problem with the lesson, and rendering both as
    // "0%" would hide the one worth acting on.
    expect(completionRate(row(0, 0))).toBeNull();
    expect(completionRate(row(6, 0))).toBe(0);
  });
});
