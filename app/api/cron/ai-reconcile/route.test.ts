import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Part 3 — the existing ai-reconcile cron now also sweeps wallet top-ups and AI plan purchases. The real
 * route; every sweep it calls is a scripted stand-in, so this checks the route's own contract:
 * authorization, bounded calls, one failing sweep never stopping the rest, aggregates only.
 */

let authorized = false;
const calls: Record<string, unknown[]> = {};
const rec = (name: string, out: unknown = {}) => vi.fn(async (...a: unknown[]) => ((calls[name] = a), out));

vi.mock("@/lib/cron/auth", () => ({ cronAuthorized: async () => authorized }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiPlans: { plans: {} } }) }));
vi.mock("@/lib/ai/recovery", () => ({ sweepAiJobs: rec("ai", { scanned: 0 }) }));
vi.mock("@/lib/ads-platform/payment-server", () => ({ reconcilePendingAdPayments: rec("ads") }));
vi.mock("@/lib/sub/server", () => ({ reconcilePendingSubPurchases: rec("sub") }));
vi.mock("@/lib/ai/wallet/reconcile-topups", () => ({ reconcilePendingTopups: vi.fn(async (o: unknown) => ((calls.wallet = [o]), { examined: 2, settled: 1, pending: 1, failed: 0, mismatched: 0, verificationFailed: 0, skipped: 0 })) }));
vi.mock("@/lib/ai/credits/plan-attempts", () => ({
  reconcilePendingPlanAttempts: vi.fn(async (_c: unknown, o: unknown) => {
    calls.plans = [o];
    throw new Error("paystack down");
  }),
}));
for (const [mod, fn] of [
  ["@/lib/admin/funding-alerts", "flushFundingAlerts"],
  ["@/lib/ai/weekly-top", "awardClosedWeek"],
  ["@/lib/rewards/paystack-payouts", "verifyProcessingPayouts"],
  ["@/lib/sub/payout-account", "sweepAutoWithdrawals"],
  ["@/lib/privacy/center", "sweepPrivacyExpiry"],
  ["@/lib/sub/reminders", "sweepSubReminders"],
  ["@/lib/sub/fanout", "sweepFanout"],
] as const) vi.doMock(mod, () => ({ [fn]: vi.fn(async () => ({})) }));
vi.mock("@/lib/rewards/v2-sweeps", () => ({ sweepFollowerMilestones: vi.fn(async () => ({})), sweepAffiliateCommissions: vi.fn(async () => ({})) }));

const { POST, GET } = await import("./route");
const call = (fn: typeof POST) => fn(new Request("https://frenzsave.com/api/cron/ai-reconcile", { method: "POST" }));

beforeEach(() => {
  authorized = false;
  for (const k of Object.keys(calls)) delete calls[k];
});

describe("ai-reconcile cron — wallet top-ups and AI plan purchases", () => {
  it("13 · an unauthorized request gets 403 and runs NOTHING", async () => {
    expect((await call(POST)).status).toBe(403);
    expect((await call(GET)).status).toBe(403);
    expect(calls).toEqual({});
  });

  it("authorized: both sweeps run, bounded (20 top-ups / 10 plans, with time budgets)", async () => {
    authorized = true;
    const res = await call(POST);
    expect(res.status).toBe(200);
    expect(calls.wallet).toEqual([{ limit: 20, budgetMs: 45_000 }]);
    expect(calls.plans).toEqual([{ limit: 10, budgetMs: 30_000 }]);
  });

  it("14 · one sweep failing never stops the others; the response is aggregates only", async () => {
    authorized = true;
    const body = (await (await call(POST)).json()) as Record<string, unknown>;
    expect(body.walletTopups).toEqual({ examined: 2, settled: 1, pending: 1, failed: 0, mismatched: 0, verificationFailed: 0, skipped: 0 });
    expect(body.aiPlanPurchases).toEqual({ error: "AI plan sweep failed" });
    expect(calls.ads).toBeDefined();
    expect(calls.sub).toBeDefined();
    expect(JSON.stringify(body)).not.toMatch(/frenz_|@|reference/);
  });

  it("the clock is the existing GitHub Actions workflow (every 10 minutes, CRON_SECRET bearer, one run at a time) — no new cron", () => {
    const wf = readFileSync(join(process.cwd(), ".github/workflows/cron-ai-reconcile.yml"), "utf8");
    expect(wf).toContain('- cron: "*/10 * * * *"');
    expect(wf).toContain('-H "Authorization: Bearer $CRON_SECRET"');
    expect(wf).toContain("group: cron-ai-reconcile");
    expect(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).not.toContain("ai-reconcile");
  });
});
