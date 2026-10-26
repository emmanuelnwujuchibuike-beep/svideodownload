import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 3: the server's door to the coin wallet. The money rules are the database's (proven in
 * supabase/tests/0279_frenz_coin.pglite.mjs and coin_concurrency.pg.mjs); pinned here: the database is handed the admin's
 * current rules with their version, a switched-off wallet asks nothing, refusals are worded, and a missing 0279 NEVER
 * falls back to an AI-credit function.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
// Part 4.2: a proof is one counted PIN attempt + its derived key (lib/coin/authorization.test.ts pins the real module).
// Here the module is replaced so the transfer path itself can be pinned: GRANT is a stand-in "issued" proof for u1 only.
const GRANT = { userId: "u1", attemptId: "att-1", keyHex: "\xabcd", method: "transaction_pin" } as const;
// closeout: a WITHDRAWAL proof is a different stand-in (a transfer proof never authorizes a withdrawal, and back)
const WGRANT = { userId: "u1", attemptId: "att-w", keyHex: "\xbeef", method: "transaction_pin", purpose: "withdrawal" } as const;
vi.mock("@/lib/coin/authorization", () => ({ isCoinTransferAuthorized: (a: unknown, userId: string, purpose = "transfer") => userId === "u1" && ((a === GRANT && purpose === "transfer") || (a === WGRANT && purpose === "withdrawal")) }));
const push = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/notifications/smart-delivery", () => ({ sendSmartPush: (...a: unknown[]) => push(...a) }));

const { COIN_DEFAULTS } = await import("./config");
const coin = await import("./server");
const on = { ...COIN_DEFAULTS, enabled: true, version: 4 };
const send = (over: Partial<Parameters<typeof coin.sendCoins>[0]> = {}) => coin.sendCoins({ senderId: "u1", accountNumber: "1234567890", amountCents: 5_000, idempotencyKey: "ct_0123456789", note: null, config: on, authorization: GRANT as never, ...over });
const result = async (over: Partial<Parameters<typeof coin.sendCoins>[0]> = {}) => {
  const out = await send(over);
  if (!out.ok) return out;
  const { announce, ...rest } = out;
  expect(typeof announce).toBe("function");
  return rest;
};
const details = { bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI" };

beforeEach(() => {
  db = fakeDb({ ai_product_balances: [], ai_product_ledger: [], coin_notification_claims: [], profiles: [{ id: "u1", handle: "ada", display_name: "Ada" }] });
  db.unique.coin_notification_claims = [["key"]];
  push.mockClear();
  db.rpc.transfer_coins_with_pin = vi.fn(() => ({ data: { ok: true, transfer_id: "t1", recipient_id: "u2", amount: 5_000, fee: 600, total: 5_600 }, error: null }));
  db.rpc.request_coin_withdrawal_with_pin = vi.fn(() => ({ data: { ok: true, id: "w1", gross: 10_000, fee: 600, net: 9_400 }, error: null }));
  db.rpc.transfer_coins = vi.fn();
  db.rpc.transfer_credits_checked = vi.fn();
  db.rpc.transfer_credits = vi.fn();
  db.rpc.request_withdrawal = vi.fn();
});

describe("sendCoins", () => {
  it("🔴 Part 4: no authorization, a forged one, or one issued to another member — refused before the database", async () => {
    for (const authorization of [null, { userId: "u1", method: "financial_pin" }, "pin:1234"]) {
      expect(await send({ authorization: authorization as never })).toMatchObject({ ok: false, status: 403, reason: "authorization_required" });
    }
    expect(await send({ senderId: "u9" })).toMatchObject({ ok: false, reason: "authorization_required" });
    expect(db.rpc.transfer_coins_with_pin).not.toHaveBeenCalled();
  });
  it("switched off is answered before authorization is even looked at", async () => {
    expect(await send({ config: { ...on, transfers: { ...on.transfers, enabled: false } }, authorization: null })).toMatchObject({ ok: false, reason: "disabled" });
  });
  it("hands the database the current transfer rules with their version (the database prices it)", async () => {
    expect(await result()).toEqual({ ok: true, transferId: "t1", amountCents: 5_000, feeCents: 600, totalCents: 5_600, duplicate: false });
    const args = (db.rpc.transfer_coins_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { p_rules: Record<string, unknown>; p_attempt: string; p_derived: string; p_sender: string; p_policy: unknown };
    // Part 4.2: the PIN proof and the exact transfer go to the database in ONE call; the bare transfer_coins is never used
    expect(args).toMatchObject({ p_sender: "u1", p_attempt: "att-1", p_derived: "\xabcd", p_policy: on.pin });
    expect(db.rpc.transfer_coins).not.toHaveBeenCalled();
    expect(args.p_rules).toMatchObject({ enabled: true, version: 4, percentBp: 1_000, lowThresholdCents: 10_000, highThresholdCents: 50_000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500 });
  });
  it("switched off: nothing is asked", async () => {
    expect(await send({ config: { ...on, enabled: false } })).toMatchObject({ ok: false, reason: "disabled" });
    expect(db.rpc.transfer_coins_with_pin).not.toHaveBeenCalled();
  });
  it("a bad amount, key or wallet number is refused before the database", async () => {
    for (const over of [{ amountCents: 0 }, { amountCents: 10.5 }, { idempotencyKey: "x" }, { accountNumber: "0123" }]) expect((await send(over)).ok).toBe(false);
    expect(db.rpc.transfer_coins_with_pin).not.toHaveBeenCalled();
  });
  it.each([
    ["insufficient", 402],
    ["daily_limit", 429],
    ["suspended", 403],
    ["recipient_unavailable", 409],
    ["recovery_due", 403],
    ["self", 400],
  ])("the database's %s is answered with %i", async (reason, status) => {
    db.rpc.transfer_coins_with_pin = vi.fn(() => ({ data: { ok: false, reason }, error: null }));
    expect(await send()).toMatchObject({ ok: false, status, reason });
  });
  it("a replayed key that names another transfer is refused (0280)", async () => {
    db.rpc.transfer_coins_with_pin = vi.fn(() => ({ data: { ok: false, reason: "idempotency_conflict" }, error: null }));
    expect(await send()).toMatchObject({ ok: false, status: 409, reason: "idempotency_conflict" });
  });
  it("the recipient is told once, after the commit: a second announce and a replay notify nobody", async () => {
    db.tables.ai_product_ledger = [{ id: "l1", user_id: "u2", product: "frenz_coin", kind: "transfer_in", reference: "coin-transfer:t1", notified_at: null }];
    const out = await send();
    expect(out.ok).toBe(true);
    expect(push).not.toHaveBeenCalled();
    if (out.ok) {
      await out.announce();
      await out.announce();
    }
    // closeout: the recipient once (coin_transfer_received), and the sender once (coin_transfer_sent, its own claim)
    const toRecipient = push.mock.calls.filter((c) => c[0] === "u2");
    const toSender = push.mock.calls.filter((c) => c[0] === "u1");
    expect(toRecipient).toHaveLength(1);
    expect(toSender).toHaveLength(1);
    expect((toRecipient[0]![1] as { title: string }).title).toBe("You received $50.00 in Frenz Coin");
    expect((toRecipient[0]![1] as { tag: string }).tag).toBe("coin-transfer-t1");
    expect(toRecipient[0]![4]).toEqual({ type: "coin_transfer_received" });
    expect(toSender[0]![4]).toEqual({ type: "coin_transfer_sent" });
    db.rpc.transfer_coins_with_pin = vi.fn(() => ({ data: { ok: true, duplicate: true, transfer_id: "t1", amount: 5_000, fee: 600, total: 5_600 }, error: null }));
    const replay = await send();
    if (replay.ok) await replay.announce();
    expect(push).toHaveBeenCalledTimes(2);
  });
  it("a push that fails never throws and never repeats the transfer", async () => {
    db.tables.ai_product_ledger = [{ id: "l1", user_id: "u2", product: "frenz_coin", kind: "transfer_in", reference: "coin-transfer:t1", notified_at: null }];
    push.mockImplementationOnce(async () => {
      throw new Error("push down");
    });
    const out = await send();
    if (out.ok) await expect(out.announce()).resolves.toBeUndefined();
    expect(db.rpc.transfer_coins_with_pin).toHaveBeenCalledTimes(1);
    if (out.ok) await out.announce();
    // the recipient's failed push is not retried; the sender's notice went once
    expect(push.mock.calls.filter((c) => c[0] === "u2")).toHaveLength(1);
    expect(push.mock.calls.filter((c) => c[0] === "u1")).toHaveLength(1);
  });
  it("🔴 0279 missing: 'not available' — never an AI-credit transfer", async () => {
    db.rpc.transfer_coins_with_pin = vi.fn(() => ({ data: null, error: { message: "function public.transfer_coins does not exist" } }));
    expect(await send()).toMatchObject({ ok: false, status: 503, reason: "not_available" });
    expect(db.rpc.transfer_credits_checked).not.toHaveBeenCalled();
    expect(db.rpc.transfer_credits).not.toHaveBeenCalled();
  });
});

describe("requestCoinWithdrawal", () => {
  const ask = (over: Partial<Parameters<typeof coin.requestCoinWithdrawal>[0]> = {}) => coin.requestCoinWithdrawal({ userId: "u1", grossCents: 10_000, method: "paystack", details, idempotencyKey: "cw_0123456789", config: on, authorization: WGRANT as never, ...over });
  it("🔴 closeout: no proof, or a TRANSFER proof, never requests a withdrawal (nothing reaches the database)", async () => {
    for (const authorization of [null, GRANT]) expect(await ask({ authorization: authorization as never })).toMatchObject({ ok: false, status: 403, reason: "authorization_required" });
    expect(db.rpc.request_coin_withdrawal_with_pin).not.toHaveBeenCalled();
  });
  it("the PIN proof and the request go to the database in ONE call", async () => {
    await ask();
    expect((db.rpc.request_coin_withdrawal_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ p_user: "u1", p_attempt: "att-w", p_derived: "\xbeef", p_gross: 10_000, p_policy: on.pin });
  });
  it("hands the database the withdrawal rules (its own 6% fee, no credit / SUB tiers)", async () => {
    expect(await ask()).toEqual({ ok: true, id: "w1", grossCents: 10_000, feeCents: 600, netCents: 9_400, duplicate: false });
    const args = (db.rpc.request_coin_withdrawal_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { p_rules: Record<string, unknown> };
    expect(args.p_rules).toMatchObject({ enabled: true, version: 4, percentBp: 600, flatCents: 0, requireEmailConfirmed: true });
    expect(args.p_rules).not.toHaveProperty("flatFees");
  });
  it("🔴 0279 missing: never the AI-credit withdrawal", async () => {
    db.rpc.request_coin_withdrawal_with_pin = vi.fn(() => ({ data: null, error: { message: "Could not find the function public.request_coin_withdrawal in the schema cache" } }));
    expect(await ask()).toMatchObject({ ok: false, reason: "not_available" });
    expect(db.rpc.request_withdrawal).not.toHaveBeenCalled();
  });
  it("an out-of-range amount names the configured range", async () => {
    db.rpc.request_coin_withdrawal_with_pin = vi.fn(() => ({ data: { ok: false, reason: "amount_out_of_range" }, error: null }));
    expect((await ask()).ok === false && (await ask() as { error: string }).error).toBe("Withdraw between $5.00 and $5000.00.");
  });
});

describe("coinWallet", () => {
  it("available = balance − pending; total = balance + held", async () => {
    db.tables.ai_product_balances = [{ user_id: "u1", product: "frenz_coin", balance_cents: 10_000, pending_cents: 2_500, held_cents: 4_000 }];
    expect(await coin.coinWallet("u1")).toEqual({ availableCents: 7_500, pendingCents: 2_500, heldCents: 4_000, totalCents: 14_000 });
  });
  it("no wallet yet: zeros", async () => {
    expect(await coin.coinWallet("u2")).toEqual({ availableCents: 0, pendingCents: 0, heldCents: 0, totalCents: 0 });
  });
});
