import { beforeEach, describe, expect, it, vi } from "vitest";

import { COIN_DEFAULTS, normalizeCoinConfig } from "@/lib/coin/config";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 6 — every route the admin console calls, pinned for its authorization:
 *   · not an administrator → 403 and nothing runs;
 *   · an administrator without a fresh password → 403 REAUTH_REQUIRED, the refusal audited, and the money function is
 *     NEVER called (the console's password prompt then replays the request once);
 *   · with a fresh password → the existing function runs, with the admin's id.
 * Plus the new read-only transfer lookup (admin only, never a write), the extended withdrawal read (rate snapshot,
 * member), and that a coin settings change — the payout rate, a fee, the hold, adminAlerts — counts as a MONEY change
 * (so the settings API asks for a fresh password for it).
 */
let db: FakeDb;
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
let admin: { id: string } | null = { id: ADMIN_ID };
let reauthed = false;
const resolveWithdrawal = vi.fn(async () => ({ ok: true }));
const rejectPaystackWithdrawal = vi.fn(async () => ({ ok: true, outcome: "rejected" }));
const payWithdrawal = vi.fn(async () => ({ ok: true, provider: "paystack", status: "processing" }));
const recordRev = vi.fn(async () => ({ ok: true, id: "rev-1", state: "recovered", phase: "released", due: 100, recovered: 100, shortfall: 0, duplicate: false }));
const resolveDispute = vi.fn(async () => ({ ok: true }));
const applyPartial = vi.fn(async () => ({ ok: true }));
const clearShortfall = vi.fn(async () => ({ ok: true }));
const correctRpc = vi.fn(() => ({ data: { ok: true, id: "corr-1", amount: 600, duplicate: false }, error: null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ hasRecentReauth: async () => reauthed }));
vi.mock("@/lib/rewards/withdrawals", () => ({ resolveWithdrawal }));
vi.mock("@/lib/rewards/paystack-payouts", () => ({ rejectPaystackWithdrawal }));
vi.mock("@/lib/rewards/flutterwave-payouts", () => ({ payWithdrawal }));
vi.mock("@/lib/coin/deposits", async (orig) => ({ ...(await orig<typeof import("@/lib/coin/deposits")>()), recordAdminCoinDepositReversal: recordRev, resolveCoinDepositDispute: resolveDispute, applyCoinDepositPartialRefund: applyPartial, clearCoinDepositShortfall: clearShortfall, listCoinDepositReversals: async () => ({ ok: true, rows: [] }) }));

const wd = await import("./../rewards/withdrawals/[id]/route");
const pay = await import("./../rewards/withdrawals/[id]/paystack/route");
const correct = await import("./coin-transfers/[id]/correct/route");
const transfers = await import("./coin-transfers/route");
const withdrawals = await import("./coin-withdrawals/route");
const revList = await import("./coin-deposit-reversals/route");
const revOne = await import("./coin-deposit-reversals/[id]/route");
const { financialChanges, DEFAULT_LANDING } = await import("@/lib/landing/settings");

const ID = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";
const post = (body?: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const audit = () => (db.tables.financial_audit_log ?? []).map((r) => r.action);
const REF = "frenz_coin_dep_fw_2b1c8f8e-1111-4111-8111-111111111111";

beforeEach(() => {
  db = fakeDb({
    financial_audit_log: [],
    profiles: [
      { id: S, handle: "ada", display_name: "Ada" },
      { id: R, handle: "bo", display_name: "Bo" },
      { id: ADMIN_ID, handle: "boss", display_name: "Admin" },
    ],
    coin_transfers: [{ id: T, sender_id: S, recipient_id: R, amount_cents: 5_000, fee_cents: 600, total_debit_cents: 5_600, bracket: "below", created_at: "2026-10-25T10:00:00Z" }],
    coin_transfer_corrections: [{ id: "c1", transfer_id: T, kind: "sender_credit", amount_cents: 1_000, reason: "duplicate charge confirmed", admin_id: ADMIN_ID, created_at: "2026-10-25T11:00:00Z" }],
    withdrawal_requests: [{ id: ID, user_id: S, source: "coin", status: "approved", gross_cents: 10_000, fee_cents: 600, net_cents: 9_400, payout_currency: "NGN", payout_minor: 14_100_00, payout_fx: { source: "fixed", minorPerUsd: 150_000, netCents: 9_400, at: "2026-10-25T09:00:00Z" }, payout_details: { bankName: "Test Bank", accountNumber: "0123456789" }, payout_reference: null, created_at: "2026-10-25T08:00:00Z", updated_at: null }],
  });
  db.rpc.correct_coin_transfer = correctRpc;
  admin = { id: ADMIN_ID };
  reauthed = false;
  for (const f of [resolveWithdrawal, rejectPaystackWithdrawal, payWithdrawal, recordRev, resolveDispute, applyPartial, clearShortfall, correctRpc]) f.mockClear();
});

// every money call the console makes, with the function that must NOT run without a fresh password
const MONEY = [
  ["approve a withdrawal", () => wd.POST(post({ status: "approved" }), ctx(ID)), resolveWithdrawal],
  ["reject a withdrawal", () => wd.POST(post({ status: "rejected", note: "not eligible" }), ctx(ID)), rejectPaystackWithdrawal],
  ["pay a withdrawal", () => pay.POST(post(), ctx(ID)), payWithdrawal],
  ["correct a transfer", () => correct.POST(post({ kind: "fee_refund", reason: "fee charged twice by error", idempotencyKey: "adm_abcdefgh12" }), ctx(T)), correctRpc],
  ["record a deposit reversal", () => revList.POST(post({ reference: REF, kind: "refund", idempotencyKey: "adm_abcdefgh34", note: "refund seen in dashboard" })), recordRev],
  ["resolve a dispute", () => revOne.POST(post({ action: "resolve", outcome: "won", note: "won in dashboard" }), ctx(ID)), resolveDispute],
  ["apply a partial refund", () => revOne.POST(post({ action: "apply_partial", note: "partial confirmed" }), ctx(ID)), applyPartial],
  ["settle a shortfall", () => revOne.POST(post({ action: "clear", note: "written off" }), ctx(ID)), clearShortfall],
] as const;

describe("money actions: administrator + fresh password, or nothing runs", () => {
  it.each(MONEY)("%s — not an admin: 403, nothing runs", async (_n, call, fn) => {
    admin = null;
    expect((await call()).status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });
  it.each(MONEY)("%s — stale password: REAUTH_REQUIRED, refusal audited, nothing runs", async (_n, call, fn) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("REAUTH_REQUIRED");
    expect(fn).not.toHaveBeenCalled();
    expect(audit()).toContain("admin_step_up_required");
  });
  it.each(MONEY)("%s — fresh password: the existing function runs", async (_n, call, fn) => {
    reauthed = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("the correction carries the admin's id and the client's replay key — and never an amount for a fee refund", async () => {
    reauthed = true;
    await correct.POST(post({ kind: "fee_refund", reason: "fee charged twice by error", idempotencyKey: "adm_abcdefgh12" }), ctx(T));
    const args = (correctRpc.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args).toMatchObject({ p_transfer: T, p_kind: "fee_refund", p_amount: null, p_admin: ADMIN_ID, p_idempotency: "adm_abcdefgh12" });
  });
});

describe("reads: administrators only, never a write", () => {
  it("the transfer lookup refuses a non-admin and a malformed id", async () => {
    admin = null;
    expect((await transfers.GET(new Request("https://frenzsave.com/x"))).status).toBe(403);
    admin = { id: ADMIN_ID };
    expect((await transfers.GET(new Request("https://frenzsave.com/x?id=nope"))).status).toBe(400);
  });
  it("one transfer: parties by public name, the corrections with who and why, and what is still correctable", async () => {
    const res = await transfers.GET(new Request(`https://frenzsave.com/x?id=${T}`));
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { items } = await res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: T, amountCents: 5_000, feeCents: 600, totalCents: 5_600, sender: { handle: "ada" }, recipient: { handle: "bo" }, feeRefundable: true, creditRemainingCents: 4_000 });
    expect(items[0].corrections[0]).toMatchObject({ kind: "sender_credit", amountCents: 1_000, reason: "duplicate charge confirmed", admin: { handle: "boss" } });
    expect(db.writes).toHaveLength(0);
  });
  it("a refunded fee is no longer refundable", async () => {
    db.tables.coin_transfer_corrections!.push({ id: "c2", transfer_id: T, kind: "fee_refund", amount_cents: 600, reason: "fee refunded", admin_id: ADMIN_ID, created_at: "2026-10-25T12:00:00Z" });
    const { items } = await (await transfers.GET(new Request(`https://frenzsave.com/x?id=${T}`))).json();
    expect(items[0].feeRefundable).toBe(false);
  });
  it("the withdrawal list carries the recorded rate snapshot and the member", async () => {
    const res = await withdrawals.GET();
    const body = await res.json();
    expect(body.open[0]).toMatchObject({ id: ID, grossCents: 10_000, feeCents: 600, netCents: 9_400, payout: { currency: "NGN", minor: 14_100_00 }, payoutFx: { source: "fixed", minorPerUsd: 150_000 }, member: { handle: "ada" }, bank: { last4: "6789" } });
    admin = null;
    expect((await withdrawals.GET()).status).toBe(403);
  });
});

describe("coin settings are money settings (the settings API asks for a fresh password)", () => {
  const cur = { frenzRewards: DEFAULT_LANDING.frenzRewards, frenzAiPlans: DEFAULT_LANDING.frenzAiPlans, frenzAiMinTopupCents: DEFAULT_LANDING.frenzAiMinTopupCents, frenzCoin: COIN_DEFAULTS };
  const changed = (patch: Record<string, unknown>) => financialChanges({ ...cur } as never, { ...cur, frenzCoin: normalizeCoinConfig({ ...COIN_DEFAULTS, ...patch }) } as never);
  it.each([
    ["the payout rate source", { withdrawals: { ...COIN_DEFAULTS.withdrawals, payoutRateSource: "market" } }],
    ["a transfer fee", { transfers: { ...COIN_DEFAULTS.transfers, percentBp: 900 } }],
    ["the deposit hold", { deposits: { ...COIN_DEFAULTS.deposits, holdHours: 5 } }],
    ["the admin alert channel", { adminAlerts: "email" }],
    ["the master switch", { enabled: true }],
  ])("%s", (_n, patch) => {
    const out = changed(patch);
    expect(out.map((c) => c.surface)).toContain("frenz_coin");
  });
  it("teeth: no change, no money change", () => {
    expect(changed({}).filter((c) => c.surface === "frenz_coin")).toEqual([]);
  });
});
