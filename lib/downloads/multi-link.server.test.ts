import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily-allowance lifecycle, against a faithful in-memory stand-in for the
 * Redis counter.
 *
 * ── Why this is mocked, and why that is still a real test ─────────────────
 * The counter is Upstash Redis. In local dev `UPSTASH_REDIS_REST_URL` and
 * `_TOKEN` are present but set to the EMPTY STRING, so `hasUpstash` is false,
 * `dailyRedis` is null, and `consumeDaily` fails open returning `used: 0` —
 * by design (a broken counter must never stop a download). Confirmed live:
 * three `POST /commit` calls against a running dev server all returned
 * `used: 0`. That is correct behaviour and it also means a dev-server probe
 * CANNOT see this code work or fail. Exactly the empty-env-var trap
 * `lib/cron/auth.test.ts` was written for.
 *
 * So the fake below implements the REAL semantics — a monotonic per-key INCR,
 * a receipt written only on a successful charge, `allowed = used <= limit` —
 * and the assertions are about the orchestration this module owns: peek at
 * authorize, consume-with-receipt at commit, short-circuit on a replay, and
 * never counting a paying member. The Redis primitive itself is already
 * exercised in production by `checkDownloadQuota` and `completeRewardSession`;
 * what was never covered is the policy layer on top of it.
 */

/*
  `multi-link.ts` opens with `import "server-only"`, whose package entry throws
  ("This module cannot be imported from a Client Component") outside a real
  server bundle — including under vitest, which is neither. Neutralised here
  rather than by aliasing it globally in vitest.config.ts: the guard is doing
  its job, this is the one file that needs to reach past it, and a project-wide
  alias would quietly disable the protection for every future test too.
*/
vi.mock("server-only", () => ({}));

// ── A stand-in with the real counter's semantics ────────────────────────────
const counters = new Map<string, number>();
const receipts = new Set<string>();

vi.mock("@/lib/rate-limit", () => ({
  peekDaily: async (key: string) => counters.get(key) ?? 0,
  alreadyCounted: async (receipt: string) => receipts.has(receipt),
  consumeDaily: async (key: string, limit: number, receipt?: string) => {
    const used = (counters.get(key) ?? 0) + 1;
    counters.set(key, used);
    const allowed = used <= limit;
    // Only a SUCCESSFUL charge writes a receipt — otherwise a refused batch
    // could smuggle a retry through on an id that never paid.
    if (allowed && receipt) receipts.add(receipt);
    return { allowed, used, limit, remaining: Math.max(0, limit - used) };
  },
}));

const plan = vi.fn<() => Promise<"free" | "pro" | "business">>();
vi.mock("@/lib/monetization/plan", () => ({ getUserPlan: () => plan() }));

// No settings row ⇒ DEFAULT_MULTI_LINK, which is what the spec's numbers are.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      upsert: async () => ({}),
    }),
  }),
}));

const { authorizeBatch, commitBatch, getBatchPolicy } = await import("./multi-link");

const IP = "203.0.113.7";
const guest = { userId: null, ip: IP };

beforeEach(() => {
  counters.clear();
  receipts.clear();
  plan.mockResolvedValue("free");
  // getMultiLinkSettings caches for 60s inside the module; the mocked client
  // always returns the defaults, so a warm cache is the same answer.
});

describe("authorize spends nothing (§16 step 4)", () => {
  it("leaves the allowance untouched however many times it is called", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await authorizeBatch({ ...guest, sourceCount: 2, itemCount: 4 });
      expect(r.ok).toBe(true);
    }
    expect(counters.size).toBe(0);
    const policy = await getBatchPolicy(guest);
    expect(policy.used).toBe(0);
    expect(policy.remaining).toBe(2);
  });

  it("refuses more sources than the plan allows", async () => {
    const r = await authorizeBatch({ ...guest, sourceCount: 4, itemCount: 4 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("TOO_MANY_SOURCES");
    // A refusal must not have cost anything either.
    expect(counters.size).toBe(0);
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

describe("commit spends exactly one (§16 step 10, §18)", () => {
  it("charges once per batch and counts down", async () => {
    expect(await commitBatch({ ...guest, batchId: "batch-a" })).toMatchObject({
      allowed: true,
      used: 1,
      remaining: 1,
    });
    expect(await commitBatch({ ...guest, batchId: "batch-b" })).toMatchObject({
      allowed: true,
      used: 2,
      remaining: 0,
    });
  });

  it("is idempotent — a replayed commit does not double-charge", async () => {
    // The refresh / retried-request / re-mounted-component case.
    await commitBatch({ ...guest, batchId: "batch-a" });
    await commitBatch({ ...guest, batchId: "batch-a" });
    await commitBatch({ ...guest, batchId: "batch-a" });
    expect(counters.get(`batchsess:ip:${IP}`)).toBe(1);
    expect((await getBatchPolicy(guest)).remaining).toBe(1);
  });

  it("refuses the third distinct batch of the day", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b2" });
    const third = await commitBatch({ ...guest, batchId: "b3" });
    expect(third.allowed).toBe(false);
  });

  it("and authorize then refuses up front, so no ad is shown (§20)", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b2" });
    const r = await authorizeBatch({ ...guest, sourceCount: 1, itemCount: 1 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("DAILY_LIMIT_REACHED");
  });

  it("does not write a receipt for a refused charge", async () => {
    await commitBatch({ ...guest, batchId: "b1" });
    await commitBatch({ ...guest, batchId: "b2" });
    await commitBatch({ ...guest, batchId: "b3" }); // refused
    expect(receipts.has("batchsess:b3")).toBe(false);
    // …so it cannot ride a receipt it never paid for on a retry.
    expect((await commitBatch({ ...guest, batchId: "b3" })).allowed).toBe(false);
  });
});

describe("paying members are never counted (§19)", () => {
  it("does not touch the counter for Pro or Business", async () => {
    for (const p of ["pro", "business"] as const) {
      counters.clear();
      plan.mockResolvedValue(p);
      for (let i = 0; i < 10; i++) {
        expect(await commitBatch({ ...guest, batchId: `b${i}` })).toMatchObject({
          allowed: true,
          remaining: null,
        });
      }
      expect(counters.size).toBe(0);
      expect((await getBatchPolicy(guest)).remaining).toBeNull();
    }
  });

  it("enforces free limits again the moment Pro lapses", async () => {
    // §19: "If the user loses Pro access, the server must immediately enforce
    // Free limitations." Nothing is cached per-user, so the next call simply
    // resolves the real plan.
    plan.mockResolvedValue("pro");
    expect((await getBatchPolicy(guest)).sourceLimit).toBe(6);
    plan.mockResolvedValue("free");
    expect((await getBatchPolicy(guest)).sourceLimit).toBe(3);
    expect((await authorizeBatch({ ...guest, sourceCount: 5, itemCount: 2 })).ok).toBe(false);
  });
});

describe("identity", () => {
  it("keys a signed-in member by account, not IP, so it follows devices", async () => {
    await commitBatch({ userId: "user-1", ip: "1.1.1.1", batchId: "b1" });
    // Same account, different network — still the same allowance.
    await commitBatch({ userId: "user-1", ip: "2.2.2.2", batchId: "b2" });
    expect(counters.get("batchsess:u:user-1")).toBe(2);
    expect(await getBatchPolicy({ userId: "user-1", ip: "9.9.9.9" })).toMatchObject({
      used: 2,
      remaining: 0,
    });
  });

  it("keeps separate visitors separate", async () => {
    await commitBatch({ userId: null, ip: "1.1.1.1", batchId: "b1" });
    await commitBatch({ userId: null, ip: "1.1.1.1", batchId: "b2" });
    const other = await getBatchPolicy({ userId: null, ip: "5.5.5.5" });
    expect(other.remaining).toBe(2);
  });
});
