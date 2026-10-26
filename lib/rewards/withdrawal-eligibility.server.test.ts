import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 2 (0278, M1-M3): an AI-credit withdrawal is authorised on the SERVER — approved qualification, not
 * suspended, not restricted — before anything is held, and the day / 30-day limits are counted in the same transaction
 * as the hold (request_credit_withdrawal). The UI check (features/rewards/rewards-page.tsx) is no longer the only one.
 * The SQL itself is proven in supabase/tests/0278_financial_safety.pglite.mjs and credit_wallet_concurrency.pg.mjs.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: async () => {} }));
vi.mock("@/lib/email/member-email", () => ({ emailMember: async () => "sent" }));
vi.mock("./paystack-banks", () => ({ resolveAccount: async () => "ADA OBI" }));

const cfg = await import("./config");
const { requestWithdrawal } = await import("./withdrawals");
const U = "00000000-0000-4000-8000-000000000001";
const details = { bankCode: "058", bankName: "GTBank", accountNumber: "0123456789" };
const config = () => {
  const c = cfg.normalizeRewardsConfig({});
  return { ...c, enabled: true, withdrawals: { ...c.withdrawals, enabled: true, methods: ["paystack"], minCredits: 100, maxCredits: 10_000, maxRequestsPerDay: 2, maxCreditsPerMonth: 20_000 } };
};
const ask = (extra: Partial<Parameters<typeof requestWithdrawal>[0]> = {}) => requestWithdrawal({ userId: U, credits: 1_000, method: "paystack", details, config: config(), ...extra });

beforeEach(() => {
  db = fakeDb({
    profiles: [{ id: U, is_suspended: false }],
    reward_profiles: [{ user_id: U, qualified_at: null, qualification_status: "approved", restricted: false }],
    withdrawal_requests: [],
    ai_product_balances: [{ user_id: U, product: "character_replace", withdrawable_cents: 50_000, deposited_cents: 0 }],
  });
  db.rpc.request_credit_withdrawal = vi.fn(() => ({ data: { ok: true, id: "w-0278" }, error: null }));
  db.rpc.request_withdrawal = vi.fn(() => ({ data: { ok: true, id: "w-old" }, error: null }));
});

describe("M1: the withdrawal approval is the server's", () => {
  it("an unapproved member is refused before anything is held — whatever the page shows", async () => {
    db.tables.reward_profiles = [{ user_id: U, qualified_at: null, qualification_status: "applied", restricted: false }];
    expect(await ask()).toMatchObject({ ok: false, status: 403, error: "Your account isn't approved for withdrawals yet." });
    expect(db.rpc.request_credit_withdrawal).not.toHaveBeenCalled();
    expect(db.rpc.request_withdrawal).not.toHaveBeenCalled();
  });
  it("no rewards profile at all is not an approval", async () => {
    db.tables.reward_profiles = [];
    expect((await ask()).ok).toBe(false);
    expect(db.rpc.request_credit_withdrawal).not.toHaveBeenCalled();
  });
  it("a legacy auto-qualified member (qualified_at set, status none) still withdraws — the rewards page's rule", async () => {
    db.tables.reward_profiles = [{ user_id: U, qualified_at: "2026-10-01T00:00:00.000Z", qualification_status: "none", restricted: false }];
    expect(await ask()).toMatchObject({ ok: true, id: "w-0278" });
  });
});

describe("M2: suspension and restriction", () => {
  it("a suspended member is refused", async () => {
    db.tables.profiles = [{ id: U, is_suspended: true }];
    expect(await ask()).toMatchObject({ ok: false, status: 403 });
    expect(db.rpc.request_credit_withdrawal).not.toHaveBeenCalled();
  });
  it("a restricted member is refused", async () => {
    db.tables.reward_profiles = [{ user_id: U, qualified_at: null, qualification_status: "approved", restricted: true }];
    expect(await ask()).toMatchObject({ ok: false, status: 403 });
  });
  it("an unreadable profile fails CLOSED", async () => {
    db.failOn.profiles = "connection reset";
    expect(await ask()).toMatchObject({ ok: false, status: 503 });
    expect(db.rpc.request_credit_withdrawal).not.toHaveBeenCalled();
  });
});

describe("M3: the limits are counted in the transaction", () => {
  it("0278's function gets the limits, what the 30-day limit counts (the amount), and the replay key", async () => {
    await ask({ idempotencyKey: "rw_0123456789abcdef" });
    const args = (db.rpc.request_credit_withdrawal as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_user_id: U, p_count_credits: 1_000, p_idempotency: "rw_0123456789abcdef", p_max_per_day: 2, p_max_credits_month: 20_000 });
    // the flat fee is held on top (lib/rewards/withdrawals.ts), never counted as part of the amount asked
    expect(Number(args.p_credits)).toBeGreaterThan(1_000);
    expect(db.rpc.request_withdrawal).not.toHaveBeenCalled();
  });
  it.each([
    ["day_limit", 429],
    ["month_limit", 429],
    ["not_qualified", 403],
    ["suspended", 403],
    ["recovery_due", 403],
    ["open_exists", 409],
  ])("the database's %s is answered with %i", async (reason, status) => {
    db.rpc.request_credit_withdrawal = vi.fn(() => ({ data: { ok: false, reason }, error: null }));
    expect(await ask()).toMatchObject({ ok: false, status });
  });
  it("a replay answers the first withdrawal", async () => {
    db.rpc.request_credit_withdrawal = vi.fn(() => ({ data: { ok: true, duplicate: true, id: "w-first", status: "reviewing" }, error: null }));
    expect(await ask({ idempotencyKey: "rw_0123456789abcdef" })).toMatchObject({ ok: true, id: "w-first", status: "reviewing" });
  });
  it("a malformed replay key is refused", async () => {
    expect(await ask({ idempotencyKey: "bad key!" })).toMatchObject({ ok: false, status: 400 });
  });
  it("before 0278 runs, the live request_withdrawal is used (the app-level checks still apply)", async () => {
    delete db.rpc.request_credit_withdrawal;
    expect(await ask()).toMatchObject({ ok: true, id: "w-old" });
    expect(db.rpc.request_withdrawal).toHaveBeenCalledTimes(1);
  });
  it("a real database error is NOT treated as a missing function (no fallback, nothing held twice)", async () => {
    db.rpc.request_credit_withdrawal = vi.fn(() => ({ data: null, error: { message: "deadlock detected" } }));
    expect(await ask()).toMatchObject({ ok: false, status: 503 });
    expect(db.rpc.request_withdrawal).not.toHaveBeenCalled();
  });
});
