import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Wallet setup (owner, 2026-10-26) — the pure rules and the server modules behind Wallet settings:
 *   · preferences: only four booleans, defaults on, failing OPEN; security alerts are never switchable;
 *   · the payout preview: the SAME integer rules as the database (fixed) and the payout rail (market);
 *   · saved banks: the member's own records only, never a full account number to the browser;
 *   · GET/PATCH /api/coin/preferences: the session is the member, nothing but the four booleans is accepted.
 */
let db: FakeDb;
let sessionUser: { id: string } | null;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));

const prefsLib = await import("./wallet-prefs");
const { payoutPreview } = await import("./payout-preview");
const { listSavedBanks, resolveSavedBank } = await import("./saved-banks");
const { koboFor } = await import("@/lib/rewards/paystack-banks");
const route = await import("@/app/api/coin/preferences/route");

const ME = "11111111-1111-4111-8111-111111111111";
const W1 = "aaaaaaaa-0000-4000-8000-000000000001";
const W2 = "aaaaaaaa-0000-4000-8000-000000000002";

beforeEach(() => {
  sessionUser = { id: ME };
  db = fakeDb({ notification_settings: [], withdrawal_requests: [], sub_payout_accounts: [] });
  db.unique.notification_settings = [["user_id"]];
});

describe("wallet preferences", () => {
  it("defaults: every alert on, balance shown", () => {
    expect(prefsLib.normalizeWalletPrefs(null)).toEqual({ notifyReceived: true, notifySent: true, notifyWithdrawals: true, hideBalance: false });
  });
  it("only booleans count; unknown keys and junk are ignored", () => {
    expect(prefsLib.normalizeWalletPrefs({ notifySent: false, hideBalance: "yes", evil: true })).toEqual({ notifyReceived: true, notifySent: false, notifyWithdrawals: true, hideBalance: false });
  });
  it("which switch controls which alert — and 🔴 security is never switchable", () => {
    const allOff = { notifyReceived: false, notifySent: false, notifyWithdrawals: false, hideBalance: false };
    expect(prefsLib.walletPushAllowed("coin_transfer_received", allOff)).toBe(false);
    expect(prefsLib.walletPushAllowed("coin_deposit_update", allOff)).toBe(false);
    expect(prefsLib.walletPushAllowed("coin_transfer_sent", allOff)).toBe(false);
    expect(prefsLib.walletPushAllowed("coin_withdrawal_update", allOff)).toBe(false);
    expect(prefsLib.walletPushAllowed("coin_pin_security", allOff)).toBe(true);
  });
  it("a read that fails is the defaults (fail open — alerts keep arriving)", async () => {
    db.failOn.notification_settings = "column wallet_prefs does not exist";
    expect(await prefsLib.getWalletPrefs(ME)).toEqual(prefsLib.DEFAULT_WALLET_PREFS);
  });
  it("saving merges into the stored row and writes ONLY user_id + wallet_prefs (every other notification setting is kept)", async () => {
    db.tables.notification_settings = [{ user_id: ME, push_enabled: false, wallet_prefs: { notifySent: false } }];
    const out = await prefsLib.setWalletPrefs(ME, { hideBalance: true });
    expect(out).toEqual({ ok: true, prefs: { notifyReceived: true, notifySent: false, notifyWithdrawals: true, hideBalance: true } });
    const write = db.writes.find((w) => w.table === "notification_settings")!;
    expect(Object.keys((write.values as Record<string, unknown>[])[0]!).sort()).toEqual(["user_id", "wallet_prefs"]);
    expect(db.tables.notification_settings![0]).toMatchObject({ push_enabled: false, wallet_prefs: { hideBalance: true, notifySent: false } });
  });
});

describe("the payout preview — the database's and the payout rail's own integer rules", () => {
  it("fixed: floor(net × kobo per USD / 100), exact, for awkward numbers too", () => {
    for (const [net, rate] of [[9_400, 155_050], [1, 99_999], [123_457, 160_033], [500_000, 1]] as const) {
      const p = payoutPreview(net, { payoutRateSource: "fixed", payoutMinorPerUsd: rate }, null)!;
      expect(p.estimatedMinor, `${net}×${rate}`).toBe(Number((BigInt(net) * BigInt(rate)) / 100n));
      expect(p).toMatchObject({ source: "fixed", exact: true, nairaPerUsd: rate / 100 });
    }
  });
  it("market: exactly what the payout rail would pay (koboFor), marked as an estimate", () => {
    for (const [net, perUsd] of [[9_400, 1548.2], [1, 1601.37], [77_777, 1499.99]] as const) {
      const p = payoutPreview(net, { payoutRateSource: "market", payoutMinorPerUsd: null }, perUsd)!;
      expect(p.estimatedMinor).toBe(koboFor(net, perUsd));
      expect(p.exact).toBe(false);
    }
  });
  it("no figure without an approved, usable rate", () => {
    expect(payoutPreview(9_400, { payoutRateSource: "none", payoutMinorPerUsd: 155_000 }, 1500)).toBeNull();
    expect(payoutPreview(9_400, { payoutRateSource: "fixed", payoutMinorPerUsd: null }, null)).toBeNull();
    expect(payoutPreview(9_400, { payoutRateSource: "market", payoutMinorPerUsd: null }, null)).toBeNull();
    expect(payoutPreview(0, { payoutRateSource: "fixed", payoutMinorPerUsd: 155_000 }, null)).toBeNull();
  });
});

describe("saved bank accounts — the member's existing records, masked", () => {
  beforeEach(() => {
    db.tables.sub_payout_accounts = [{ creator_id: ME, bank_code: "033", bank_name: "UBA", account_number: "2222222222", account_name: "ADA OBI" }];
    db.tables.withdrawal_requests = [
      { id: W1, user_id: ME, status: "completed", payout_method: "paystack", payout_details: { bankCode: "044", bankName: "Access Bank", accountNumber: "1234567890", accountName: "ADA OBI" }, created_at: "2026-10-02" },
      { id: W2, user_id: ME, status: "completed", payout_method: "paystack", payout_details: { bankCode: "044", bankName: "Access Bank", accountNumber: "1234567890" }, created_at: "2026-10-01" },
      { id: "aaaaaaaa-0000-4000-8000-000000000003", user_id: ME, status: "reversed", payout_method: "paystack", payout_details: { bankCode: "057", bankName: "Zenith", accountNumber: "5555555555" }, created_at: "2026-10-03" },
      { id: "aaaaaaaa-0000-4000-8000-000000000004", user_id: "someone", status: "completed", payout_method: "paystack", payout_details: { bankCode: "058", bankName: "GTBank", accountNumber: "9999999999" }, created_at: "2026-10-04" },
    ];
  });

  it("the SUB account and each distinct earlier bank, newest first — 🔴 never a full account number", async () => {
    const banks = await listSavedBanks(ME);
    expect(banks).toEqual([
      { id: "sub", bankName: "UBA", last4: "2222", accountName: "ADA OBI" },
      { id: `w:${W1}`, bankName: "Access Bank", last4: "7890", accountName: "ADA OBI" },
    ]);
    const json = JSON.stringify(banks);
    for (const full of ["2222222222", "1234567890", "5555555555", "9999999999"]) expect(json).not.toContain(full);
  });
  it("resolves only THIS member's own, usable records", async () => {
    expect(await resolveSavedBank(ME, `w:${W1}`)).toEqual({ bankCode: "044", bankName: "Access Bank", accountNumber: "1234567890" });
    expect(await resolveSavedBank(ME, "sub")).toEqual({ bankCode: "033", bankName: "UBA", accountNumber: "2222222222" });
    expect(await resolveSavedBank(ME, "w:aaaaaaaa-0000-4000-8000-000000000004")).toBeNull(); // someone else's
    expect(await resolveSavedBank(ME, "w:aaaaaaaa-0000-4000-8000-000000000003")).toBeNull(); // sent back by the bank
    expect(await resolveSavedBank("22222222-2222-4222-8222-222222222222", "sub")).toBeNull(); // no SUB account
    expect(await resolveSavedBank(ME, "w:../../x")).toBeNull();
  });
});

describe("GET / PATCH /api/coin/preferences", () => {
  const patch = (b: unknown) => route.PATCH(new Request("https://x.test/api/coin/preferences", { method: "PATCH", body: JSON.stringify(b) }));
  it("signed out: 401 both ways, nothing written", async () => {
    sessionUser = null;
    expect((await route.GET()).status).toBe(401);
    expect((await patch({ hideBalance: true })).status).toBe(401);
    expect(db.writes).toEqual([]);
  });
  it("saves the session member's own preferences", async () => {
    const res = await patch({ notifyReceived: false });
    expect(res.status).toBe(200);
    expect((await res.json()).prefs.notifyReceived).toBe(false);
    expect(db.tables.notification_settings![0]).toMatchObject({ user_id: ME });
  });
  it.each([
    ["an unknown key", { notifyReceived: false, userId: "someone" }],
    ["a non-boolean", { hideBalance: "yes" }],
    ["nothing at all", {}],
  ])("refuses %s (400), nothing written", async (_l, b) => {
    expect((await patch(b)).status).toBe(400);
    expect(db.writes).toEqual([]);
  });
});
