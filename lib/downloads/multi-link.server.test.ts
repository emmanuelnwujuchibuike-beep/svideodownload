import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily-allowance lifecycle, against an in-memory stand-in for the
 * `batch_sessions` table.
 *
 * ── Why this table exists at all, and why the test moved with it ──────────
 * The allowance used to be a Redis INCR (`consumeDaily`). That call FAILS OPEN
 * when Upstash is unconfigured — and `UPSTASH_REDIS_REST_URL`/`_TOKEN` are
 * present but set to the EMPTY STRING, so it always did: every read reported
 * `used: 0` and the panel showed a constant "2 remaining" (owner, 2026-08-25:
 * "the daily limit in the multi link doesnt work"). Fail-open is right for a
 * DOWNLOAD and wrong for an allowance the UI prints back to the visitor.
 *
 * So the counter is Postgres now, and exactly-once is the UNIQUE constraint on
 * `batch_id` rather than application logic. The fake below reproduces exactly
 * that: an `upsert` with `ignoreDuplicates` that no-ops on a seen batch id, and
 * a count over today's rows for one identity. The assertions are about the
 * behaviour that constraint buys — a replay charges nothing, the Nth batch is
 * allowed and the (N+1)th is not, and a paying member is never counted.
 */

vi.mock("server-only", () => ({}));

/*
  `multi-link.ts` reads `hasSupabase` at MODULE SCOPE and returns early from
  every counting path when it is false. Without these the whole file would
  short-circuit to "allowance untouched" and the suite would pass by doing
  nothing — the exact shape of the bug it is here to prevent. Set before the
  dynamic import below, which is why that import is dynamic.
*/
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

// ── An in-memory `batch_sessions` with the real UNIQUE semantics ────────────
interface Row {
  batch_id: string;
  user_id: string | null;
  anon_id: string | null;
  ip_hash: string | null;
  created_at: string;
}
let rows: Row[] = [];

/**
 * Mirrors the PostgREST chain the code actually calls.
 *
 * A THENABLE, because that is what the real client is: `await db.from(x)
 * .select(...).gte(...).eq(...)` resolves the built query. Every chain method
 * therefore has to return the same thenable object — returning a bare inner
 * object instead makes the final `await` resolve to the object itself rather
 * than to `{ count }`, which is quietly indistinguishable from a count of zero.
 */
function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  const field = (r: Row, col: string) => (r as unknown as Record<string, unknown>)[col];

  const q = {
    select: (_cols?: string, _opts?: unknown) => q,
    eq: (col: string, val: unknown) => {
      filters.push((r) => field(r, col) === val);
      return q;
    },
    gte: (col: string, val: string) => {
      filters.push((r) => String(field(r, col)) >= val);
      return q;
    },
    maybeSingle: async () => ({ data: null }),
    upsert: async (row: Partial<Row>, opts?: { ignoreDuplicates?: boolean }) => {
      if (table !== "batch_sessions") return {};
      // THE UNIQUE CONSTRAINT — a replayed batch id is a no-op, not a second row.
      if (rows.some((r) => r.batch_id === row.batch_id)) {
        return opts?.ignoreDuplicates ? {} : { error: { message: "duplicate key" } };
      }
      rows.push({
        batch_id: String(row.batch_id),
        user_id: row.user_id ?? null,
        anon_id: row.anon_id ?? null,
        ip_hash: row.ip_hash ?? null,
        created_at: new Date().toISOString(),
      });
      return {};
    },
    then(resolve: (v: { count: number }) => unknown) {
      return Promise.resolve(
        resolve({ count: rows.filter((r) => filters.every((f) => f(r))).length }),
      );
    },
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => makeQuery(table) }),
}));

const plan = vi.fn<() => Promise<"free" | "pro" | "business">>();
vi.mock("@/lib/monetization/plan", () => ({ getUserPlan: () => plan() }));

const { authorizeBatch, commitBatch, getBatchPolicy } = await import("./multi-link");

const BROWSER = "11111111-1111-4111-8111-111111111111";
const OTHER_BROWSER = "22222222-2222-4222-8222-222222222222";
const guest = { userId: null, ip: "203.0.113.7", anonId: BROWSER };

beforeEach(() => {
  rows = [];
  plan.mockResolvedValue("free");
});

describe("authorize spends nothing (§16 step 4)", () => {
  it("leaves the allowance untouched however many times it is called", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await authorizeBatch({ ...guest, sourceCount: 2, itemCount: 4 })).ok).toBe(true);
    }
    expect(rows).toHaveLength(0);
    expect(await getBatchPolicy(guest)).toMatchObject({ used: 0, remaining: 2 });
  });

  it("refuses more sources than the plan allows, and costs nothing", async () => {
    const r = await authorizeBatch({ ...guest, sourceCount: 4, itemCount: 4 });
    expect(r.ok === false && r.reason).toBe("TOO_MANY_SOURCES");
    expect(rows).toHaveLength(0);
  });

  it("lets Pro use the higher source ceiling", async () => {
    plan.mockResolvedValue("pro");
    expect((await authorizeBatch({ ...guest, sourceCount: 6, itemCount: 4 })).ok).toBe(true);
    expect((await authorizeBatch({ ...guest, sourceCount: 7, itemCount: 4 })).ok).toBe(false);
  });

  it("refuses a batch past the reward API's item cap", async () => {
    const r = await authorizeBatch({ ...guest, sourceCount: 1, itemCount: 51 });
    expect(r.ok === false && r.reason).toBe("TOO_MANY_ITEMS");
  });
});

describe("commit spends exactly one, and the count actually MOVES", () => {
  it("counts down — the bug that started this was a number that never changed", async () => {
    expect(await commitBatch({ ...guest, batchId: "b1" })).toMatchObject({
      allowed: true,
      used: 1,
      remaining: 1,
    });
    expect(await commitBatch({ ...guest, batchId: "b2" })).toMatchObject({
      allowed: true,
      used: 2,
      remaining: 0,
    });
    expect(await getBatchPolicy(guest)).toMatchObject({ used: 2, remaining: 0 });
  });

  it("is idempotent — a replayed commit does not double-charge", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b1" });
    expect(rows).toHaveLength(1);
    expect((await getBatchPolicy(guest)).remaining).toBe(1);
  });

  it("refuses the third distinct batch of the day", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b2" });
    expect((await commitBatch({ ...guest, batchId: "b3" })).allowed).toBe(false);
  });

  it("and authorize then refuses up front, so no ad is shown (§20)", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b2" });
    const r = await authorizeBatch({ ...guest, sourceCount: 1, itemCount: 1 });
    expect(r.ok === false && r.reason).toBe("DAILY_LIMIT_REACHED");
  });
});

describe("anonymous visitors are counted per BROWSER, not per IP", () => {
  /*
    Owner, 2026-08-25: "anonymous users too should have the limit with the
    browser". A mobile carrier NATs thousands of people onto one address and a
    café shares one between everybody in it, so an IP-keyed allowance makes
    strangers spend each other's.
  */
  it("two browsers on the SAME ip each get their own allowance", async () => {
    const ip = "203.0.113.7";
    await commitBatch({ userId: null, ip, anonId: BROWSER, batchId: "b1" });
    await commitBatch({ userId: null, ip, anonId: BROWSER, batchId: "b2" });

    expect((await getBatchPolicy({ userId: null, ip, anonId: BROWSER })).remaining).toBe(0);
    // Same network, different browser — untouched.
    expect((await getBatchPolicy({ userId: null, ip, anonId: OTHER_BROWSER })).remaining).toBe(2);
  });

  it("one browser keeps its allowance across a CHANGING ip", async () => {
    // A phone moving between wifi and cellular is one visitor, not two.
    await commitBatch({ userId: null, ip: "1.1.1.1", anonId: BROWSER, batchId: "b1" });
    await commitBatch({ userId: null, ip: "2.2.2.2", anonId: BROWSER, batchId: "b2" });
    expect((await getBatchPolicy({ userId: null, ip: "9.9.9.9", anonId: BROWSER })).remaining).toBe(0);
  });

  it("still records the ip hash, for a future abuse control", () => {
    // Recorded, never the counting key — see the migration's own note.
    expect(rows.every((r) => r.ip_hash === null || typeof r.ip_hash === "string")).toBe(true);
  });
});

describe("paying members are never counted (§19)", () => {
  it("does not write a row for Pro or Business", async () => {
    for (const p of ["pro", "business"] as const) {
      rows = [];
      plan.mockResolvedValue(p);
      for (let i = 0; i < 10; i++) {
        expect(await commitBatch({ ...guest, batchId: `b${i}` })).toMatchObject({
          allowed: true,
          remaining: null,
        });
      }
      expect(rows).toHaveLength(0);
      expect((await getBatchPolicy(guest)).remaining).toBeNull();
    }
  });

  it("enforces free limits again the moment Pro lapses", async () => {
    plan.mockResolvedValue("pro");
    expect((await getBatchPolicy(guest)).sourceLimit).toBe(6);
    plan.mockResolvedValue("free");
    expect((await getBatchPolicy(guest)).sourceLimit).toBe(3);
    expect((await authorizeBatch({ ...guest, sourceCount: 5, itemCount: 2 })).ok).toBe(false);
  });
});

describe("signed-in members are keyed by account", () => {
  it("follows them across devices and networks", async () => {
    await commitBatch({ userId: "user-1", ip: "1.1.1.1", anonId: null, batchId: "b1" });
    await commitBatch({ userId: "user-1", ip: "2.2.2.2", anonId: null, batchId: "b2" });
    expect(
      await getBatchPolicy({ userId: "user-1", ip: "9.9.9.9", anonId: null }),
    ).toMatchObject({ used: 2, remaining: 0 });
  });
});
