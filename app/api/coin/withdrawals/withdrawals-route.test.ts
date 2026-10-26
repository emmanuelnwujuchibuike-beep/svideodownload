import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin closeout — POST/GET /api/coin/withdrawals with the REAL authorization and PIN modules (0283's
 * request_coin_withdrawal_with_pin modelled: a counted single-use 'withdrawal' attempt, the key compared with the
 * stored hash). Pinned: the session is the member; a confirmed email is required; the account holder is named by the
 * bank; validation happens BEFORE any PIN attempt; a wrong PIN holds nothing; the right PIN requests exactly this
 * withdrawal once; the member sees only their own withdrawals.
 */
let db: FakeDb;
let sessionUser: { id: string; email?: string; email_confirmed_at?: string | null } | null;
let coinOn = true;
let bankName: string | null = "ADA OBI";
const PEPPER = "withdraw-route-pepper-0123456789abcdef012345";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => {
  const open = { limit: async () => ({ success: true }) };
  return { aiJobCreateLimiter: open, pinLimiter: open, clientId: () => "203.0.113.9" };
});
vi.mock("@/lib/rewards/paystack-banks", async (orig) => ({ ...(await orig<typeof import("@/lib/rewards/paystack-banks")>()), resolveAccount: async () => bankName }));
vi.mock("@/lib/landing/settings", async () => {
  const { COIN_DEFAULTS } = await import("@/lib/coin/config");
  return { getLandingSettings: async () => ({ frenzCoin: { ...COIN_DEFAULTS, enabled: coinOn } }) };
});

const route = await import("./route");
const pinLib = await import("@/lib/coin/pin");
const ME = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const body = { grossCents: 10_000, bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", idempotencyKey: "cw_0123456789", pin: "482915" };
let stored: { hash: string; salt: string; params: object };
const used = new Set<string>();

beforeEach(async () => {
  vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
  sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
  coinOn = true;
  bankName = "ADA OBI";
  used.clear();
  const h = await pinLib.hashNewPin("482915", ME, PEPPER);
  stored = { hash: h.hash.toString("hex"), salt: h.salt.toString("hex"), params: h.params };
  db = fakeDb({ withdrawal_requests: [{ id: "w-mine", user_id: ME, source: "coin", status: "completed", gross_cents: 10_000, fee_cents: 600, net_cents: 9_400, payout_details: { bankName: "GTBank", accountNumber: "0123456789" }, created_at: "2026-10-20T00:00:00Z" }, { id: "w-other", user_id: "someone", source: "coin", status: "pending", gross_cents: 1, fee_cents: 0, net_cents: 1, created_at: "2026-10-20T00:00:00Z" }, { id: "w-credits", user_id: ME, source: "credits", status: "pending", created_at: "2026-10-20T00:00:00Z" }] });
  let n = 0;
  db.rpc.begin_coin_pin_attempt = vi.fn((a: Record<string, unknown>) => ({ data: a.p_purpose === "withdrawal" ? { ok: true, attempt_id: `att-${++n}`, salt: stored.salt, params: stored.params } : { ok: false }, error: null }));
  db.rpc.request_coin_withdrawal_with_pin = vi.fn((a: Record<string, unknown>) => {
    if (used.has(String(a.p_attempt)) || String(a.p_derived) !== `\\x${stored.hash}`) return { data: { ok: false, reason: "authorization_failed" }, error: null };
    used.add(String(a.p_attempt));
    return { data: { ok: true, id: "w-new", gross: a.p_gross, fee: 600, net: 9_400 }, error: null };
  });
  db.rpc.request_coin_withdrawal = vi.fn();
});

describe("POST /api/coin/withdrawals", () => {
  it("the right PIN: the gross held, 6% fee from it, the bank-named holder — for the session member", async () => {
    const res = await route.POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: "w-new", grossCents: 10_000, feeCents: 600, netCents: 9_400 });
    const args = (db.rpc.request_coin_withdrawal_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_user: ME, p_gross: 10_000, p_method: "paystack", p_details: { bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI" } });
    expect(db.rpc.request_coin_withdrawal).not.toHaveBeenCalled();
  });
  it("a wrong PIN: 403 and nothing held", async () => {
    const res = await route.POST(post({ ...body, pin: "482916" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "authorization_failed" });
  });
  it("validation comes BEFORE the PIN: bad details or a bank that names nobody never spend an attempt", async () => {
    expect((await route.POST(post({ ...body, accountNumber: "12" }))).status).toBe(400);
    bankName = null;
    expect((await route.POST(post(body))).status).toBe(400);
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
  it("signed out 401; unconfirmed email 403; switched off 503; a body naming a user or a fee 400", async () => {
    sessionUser = null;
    expect((await route.POST(post(body))).status).toBe(401);
    sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: null };
    expect((await route.POST(post(body))).status).toBe(403);
    sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
    coinOn = false;
    expect((await route.POST(post(body))).status).toBe(503);
    coinOn = true;
    for (const extra of [{ userId: "someone" }, { feeCents: 0 }, { accountName: "ME" }]) expect((await route.POST(post({ ...body, ...extra }))).status).toBe(400);
    expect(db.rpc.request_coin_withdrawal_with_pin).not.toHaveBeenCalled();
  });
  it("no pepper configured: 503, nothing asked (fail closed)", async () => {
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect((await route.POST(post(body))).status).toBe(503);
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
});

describe("GET /api/coin/withdrawals", () => {
  it("the member's own coin withdrawals only, the bank by last four digits", async () => {
    const json = await (await route.GET()).json();
    expect(json.items.map((i: { id: string }) => i.id)).toEqual(["w-mine"]);
    expect(json.items[0]).toMatchObject({ grossCents: 10_000, feeCents: 600, netCents: 9_400, bank: { name: "GTBank", last4: "6789" } });
    expect(JSON.stringify(json)).not.toContain("0123456789");
  });
});

/*
  Wallet setup (2026-10-26): a SAVED account. The browser names it by id; the server puts the full number back from the
  member's OWN records (lib/coin/saved-banks.ts), then everything runs exactly as for a typed account.
*/
describe("POST /api/coin/withdrawals — a saved account", () => {
  const saved = (savedAccount: string) => post({ ...body, bankCode: "", bankName: "", accountNumber: "", savedAccount });
  beforeEach(() => {
    db.tables.withdrawal_requests!.push(
      { id: "aaaaaaaa-0000-4000-8000-000000000001", user_id: ME, source: "credits", status: "completed", payout_method: "paystack", payout_details: { bankCode: "044", bankName: "Access Bank", accountNumber: "1234567890", accountName: "ADA OBI" }, created_at: "2026-10-01T00:00:00Z" },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", user_id: "someone-else", source: "coin", status: "completed", payout_method: "paystack", payout_details: { bankCode: "058", bankName: "GTBank", accountNumber: "9999999999" }, created_at: "2026-10-01T00:00:00Z" },
      { id: "aaaaaaaa-0000-4000-8000-000000000003", user_id: ME, source: "coin", status: "reversed", payout_method: "paystack", payout_details: { bankCode: "057", bankName: "Zenith", accountNumber: "5555555555" }, created_at: "2026-10-01T00:00:00Z" },
    );
    db.tables.sub_payout_accounts = [{ creator_id: ME, bank_code: "033", bank_name: "UBA", account_number: "2222222222", account_name: "ADA OBI" }];
  });

  it("an earlier withdrawal's bank: the SERVER fills in the full number, then the PIN holds it as usual", async () => {
    const res = await route.POST(saved("w:aaaaaaaa-0000-4000-8000-000000000001"));
    expect(res.status).toBe(200);
    const args = (db.rpc.request_coin_withdrawal_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(args).toMatchObject({ p_user: ME, p_details: { bankCode: "044", bankName: "Access Bank", accountNumber: "1234567890", accountName: "ADA OBI" } });
  });

  it("the creator's verified SUB payout account", async () => {
    expect((await route.POST(saved("sub"))).status).toBe(200);
    const args = (db.rpc.request_coin_withdrawal_with_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(args).toMatchObject({ p_details: { bankCode: "033", accountNumber: "2222222222" } });
  });

  it.each([
    ["🔴 another member's withdrawal id", "w:aaaaaaaa-0000-4000-8000-000000000002"],
    ["a withdrawal the bank sent back (reversed)", "w:aaaaaaaa-0000-4000-8000-000000000003"],
    ["an unknown id", "w:aaaaaaaa-0000-4000-8000-0000000000ff"],
    ["a malformed id", "w:not-a-uuid"],
  ])("%s → 400, no PIN attempt spent, nothing held", async (_label, id) => {
    const res = await route.POST(saved(id));
    expect(res.status).toBe(400);
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
    expect(db.rpc.request_coin_withdrawal_with_pin).not.toHaveBeenCalled();
  });

  it("the bank still names the holder for a saved account (a closed account is refused)", async () => {
    bankName = null;
    const res = await route.POST(saved("sub"));
    expect(res.status).toBe(400);
    expect(db.rpc.request_coin_withdrawal_with_pin).not.toHaveBeenCalled();
  });
});
