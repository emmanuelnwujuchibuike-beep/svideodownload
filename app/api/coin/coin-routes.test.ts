import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4 / 4.2 — the member routes, driven for real over an in-memory database, with the REAL authorization
 * and PIN modules (lib/coin/authorization.ts, lib/coin/pin.ts). The two PIN functions of 0282 are modelled here in a few
 * lines — a counted single-use attempt, the key compared with the stored hash — so the REAL key derivation is checked
 * end to end against a hash made by the REAL setup code (the SQL itself is proven in supabase/tests/0282_coin_pin.pglite.mjs).
 * Pinned:
 *   · /api/coin/transfers: the session is the sender; the PIN is required; no PIN set, a wrong PIN, a 4-digit quick-lock
 *     PIN — one 403, and no transfer reaches the database; the right PIN sends exactly the requested transfer, once;
 *     no pepper configured — 503, nothing asked (fail closed);
 *   · every route takes the member from the session, never the body;
 *   · the wallet and history read only the session member's frenz_coin rows, and the wallet says honestly whether this
 *     member can send;
 *   · the return check settles only the member's own reference, through Flutterwave — never on the redirect's word.
 */
let db: FakeDb;
let sessionUser: { id: string; email?: string; email_confirmed_at?: string | null } | null;
let coinOn = true;

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => {
  const open = { limit: async () => ({ success: true }) };
  return { aiJobCreateLimiter: open, subVerifyLimiter: open, pinLimiter: open, otpLimiter: open, clientId: () => "203.0.113.9" };
});
vi.mock("@/lib/landing/settings", async () => {
  const { COIN_DEFAULTS } = await import("@/lib/coin/config");
  return { getLandingSettings: async () => ({ frenzCoin: { ...COIN_DEFAULTS, enabled: coinOn, deposits: { ...COIN_DEFAULTS.deposits, enabled: coinOn } } }) };
});
const verifyByRef = vi.fn();
vi.mock("@/lib/flutterwave/client", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/client")>()), verifyFlutterwaveByReference: (r: string) => verifyByRef(r), createFlutterwaveCheckout: vi.fn() }));

const PEPPER = "route-test-pepper-0123456789abcdef0123456789";
const transfers = await import("./transfers/route");
const wallet = await import("./wallet/route");
const history = await import("./history/route");
const deposits = await import("./deposits/route");
const verify = await import("./deposits/verify/route");
const pinLib = await import("@/lib/coin/pin");

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const REF = "frenz_coin_dep_fw_2b1c8f8e-1111-4111-8111-111111111111";
const MY_PIN = "482915";

type StoredPin = { hash: string; salt: string; params: object };
// the stored PIN, made by the REAL setup code (what set_coin_pin would store)
let stored: StoredPin;
let pins: Record<string, StoredPin | undefined>;
let attempts: Map<string, { user: string; used: boolean }>;
let sent: { sender: string; account: string; amount: number; key: string }[];

beforeAll(async () => {
  const h = await pinLib.hashNewPin(MY_PIN, ME, PEPPER);
  stored = { hash: h.hash.toString("hex"), salt: h.salt.toString("hex"), params: h.params };
});

beforeEach(() => {
  vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
  sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
  coinOn = true;
  pins = { [ME]: stored };
  attempts = new Map();
  sent = [];
  db = fakeDb({
    ai_product_balances: [
      { user_id: ME, product: "frenz_coin", balance_cents: 30_000, pending_cents: 10_000, held_cents: 2_000 },
      { user_id: ME, product: "character_replace", balance_cents: 999_999, pending_cents: 0, held_cents: 0 },
      { user_id: OTHER, product: "frenz_coin", balance_cents: 777_777, pending_cents: 0, held_cents: 0 },
    ],
    coin_deposits: [
      { user_id: ME, amount_cents: 10_000, settled_at: "2026-10-25T10:00:00Z", release_at: "2026-10-28T10:00:00Z", status: "held" },
      { user_id: OTHER, amount_cents: 55_555, settled_at: "2026-10-25T10:00:00Z", release_at: "2026-10-28T10:00:00Z", status: "held" },
    ],
    wallet_accounts: [{ user_id: ME, account_number: "1203682058" }],
    ai_product_ledger: [],
    profiles: [],
    ai_topup_attempts: [{ id: REF, reference: REF, user_id: OTHER, provider: "flutterwave", purpose: "coin_deposit", status: "pending", amount_cents: 5_000, provider_amount: 5_000, provider_currency: "USD", checkout_url: "x", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
  });
  for (const f of ["transfer_coins", "begin_coin_deposit", "settle_coin_deposit"]) db.rpc[f] = vi.fn();
  // 0282, modelled: a counted single-use attempt; the key compared with the stored hash; the transfer in the same call
  db.rpc.begin_coin_pin_attempt = vi.fn((a: Record<string, unknown>) => {
    const pin = pins[String(a.p_user)];
    if (!pin) return { data: { ok: false, reason: "no_pin" }, error: null };
    const id = `att-${attempts.size + 1}`;
    attempts.set(id, { user: String(a.p_user), used: false });
    return { data: { ok: true, attempt_id: id, salt: pin.salt, params: pin.params }, error: null };
  });
  db.rpc.transfer_coins_with_pin = vi.fn((a: Record<string, unknown>) => {
    const att = attempts.get(String(a.p_attempt));
    const pin = pins[String(a.p_sender)];
    if (!att || att.used || att.user !== a.p_sender || !pin) return { data: { ok: false, reason: "authorization_failed" }, error: null };
    att.used = true;
    if (String(a.p_derived) !== `\\x${pin.hash}`) return { data: { ok: false, reason: "authorization_failed" }, error: null };
    sent.push({ sender: String(a.p_sender), account: String(a.p_account_number), amount: Number(a.p_amount), key: String(a.p_idempotency) });
    return { data: { ok: true, transfer_id: `t${sent.length}`, recipient_id: OTHER, amount: a.p_amount, fee: 600, total: Number(a.p_amount) + 600 }, error: null };
  });
  db.rpc.coin_pin_status = vi.fn((a: Record<string, unknown>) => ({ data: { set: !!pins[String(a.p_user)], locked_until: null }, error: null }));
  db.rpc.release_due_coin_deposits = vi.fn(() => ({ data: { ok: true, released: 0, cents: 0 }, error: null }));
  verifyByRef.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/coin/transfers — confirmed with the transaction PIN", () => {
  const body = { accountNumber: "1205519083", amountCents: 5_000, idempotencyKey: "ct_0123456789", pin: MY_PIN };
  it("the right PIN sends exactly the requested transfer, once — the sender is the session", async () => {
    const res = await transfers.POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, transferId: "t1", amountCents: 5_000, feeCents: 600, totalCents: 5_600 });
    expect(sent).toEqual([{ sender: ME, account: "1205519083", amount: 5_000, key: "ct_0123456789" }]);
    expect(db.rpc.transfer_coins).not.toHaveBeenCalled();
  });
  it("a wrong PIN, no PIN set, or a 4-digit quick-lock PIN: one 403, and nothing is sent", async () => {
    for (const pin of ["482916", "000001", "1234"]) {
      const res = await transfers.POST(post({ ...body, pin }));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toMatchObject({ reason: "authorization_failed" });
      expect(JSON.stringify(json)).not.toMatch(/482916|000001|1234|hash|salt/);
    }
    pins = {};
    const res = await transfers.POST(post(body));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "authorization_failed" });
    expect(sent).toEqual([]);
  });
  it("no pepper configured: 503, nothing asked of the database (fail closed)", async () => {
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    const res = await transfers.POST(post(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "authorization_unavailable" });
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
    expect(db.rpc.transfer_coins_with_pin).not.toHaveBeenCalled();
  });
  it("signed out: 401; switched off: 503 — before any PIN is asked", async () => {
    sessionUser = null;
    expect((await transfers.POST(post(body))).status).toBe(401);
    sessionUser = { id: ME };
    coinOn = false;
    expect((await transfers.POST(post(body))).status).toBe(503);
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
  it("no PIN in the body, or a body naming a sender, a fee, a status or an authorization: 400", async () => {
    const { pin: _pin, ...noPin } = body;
    expect((await transfers.POST(post(noPin))).status).toBe(400);
    for (const extra of [{ senderId: OTHER }, { feeCents: 0 }, { status: "completed" }, { authorization: { ok: true } }]) {
      expect((await transfers.POST(post({ ...body, ...extra }))).status).toBe(400);
    }
    expect(sent).toEqual([]);
  });
  it("every request is its own counted attempt: an earlier proof is never reused", async () => {
    await transfers.POST(post(body));
    await transfers.POST(post({ ...body, idempotencyKey: "ct_second_12345" }));
    expect(db.rpc.begin_coin_pin_attempt).toHaveBeenCalledTimes(2);
    const used = (db.rpc.transfer_coins_with_pin as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { p_attempt: string }).p_attempt);
    expect(new Set(used).size).toBe(2);
  });
});

describe("GET /api/coin/wallet", () => {
  it("the session member's coin wallet only: available = balance − pending, total = balance + held", async () => {
    const res = await wallet.GET();
    expect(res.status).toBe(200);
    const w = await res.json();
    expect(w).toMatchObject({ availableCents: 20_000, pendingCents: 10_000, heldCents: 2_000, totalCents: 32_000, walletNumber: "1203682058", nextReleaseAt: "2026-10-28T10:00:00Z" });
    expect(w.pendingDeposits).toEqual([{ amountCents: 10_000, settledAt: "2026-10-25T10:00:00Z", releaseAt: "2026-10-28T10:00:00Z", status: "held" }]);
    expect(JSON.stringify(w)).not.toMatch(/777777|55555|999999/);
    expect(w.transfers).toMatchObject({ canSend: true, blockedBy: null, pin: { set: true, lockedUntil: null } });
    expect(w.transfers.feeExamples).toEqual([
      { amountCents: 5_000, feeCents: 600, totalCents: 5_600 },
      { amountCents: 25_000, feeCents: 2_500, totalCents: 27_500 },
      { amountCents: 60_000, feeCents: 6_500, totalCents: 66_500 },
    ]);
    expect(db.rpc.release_due_coin_deposits).toHaveBeenCalledWith({ p_user: ME, p_limit: 50 });
  });
  it("says honestly why a member cannot send: no PIN, no PIN service, switched off", async () => {
    pins = {};
    expect((await (await wallet.GET()).json()).transfers).toMatchObject({ canSend: false, blockedBy: "pin_not_set" });
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect((await (await wallet.GET()).json()).transfers).toMatchObject({ canSend: false, blockedBy: "authorization_unavailable" });
    coinOn = false;
    expect((await (await wallet.GET()).json()).transfers).toMatchObject({ canSend: false, blockedBy: "disabled" });
  });
  it("signed out: 401, and nothing is read or released", async () => {
    sessionUser = null;
    expect((await wallet.GET()).status).toBe(401);
    expect(db.rpc.release_due_coin_deposits).not.toHaveBeenCalled();
  });
});

describe("GET /api/coin/history", () => {
  it("signed out: 401; a bad cursor: 400", async () => {
    sessionUser = null;
    expect((await history.GET(new Request("https://frenzsave.com/api/coin/history"))).status).toBe(401);
    sessionUser = { id: ME };
    expect((await history.GET(new Request("https://frenzsave.com/api/coin/history?cursor=%%%"))).status).toBe(400);
  });
});

describe("deposits", () => {
  it("POST /api/coin/deposits: signed out 401; a body naming a user or a status is refused", async () => {
    sessionUser = null;
    expect((await deposits.POST(post({ amountCents: 5_000, idempotencyKey: "dep_0123456789" }))).status).toBe(401);
    sessionUser = { id: ME, email: "me@t.test" };
    for (const extra of [{ userId: OTHER }, { status: "success" }, { currency: "NGN" }]) {
      expect((await deposits.POST(post({ amountCents: 5_000, idempotencyKey: "dep_0123456789", ...extra }))).status).toBe(400);
    }
    expect(db.rpc.begin_coin_deposit).not.toHaveBeenCalled();
  });
  it("POST /api/coin/deposits/verify: another member's reference is not found; nothing is asked or settled", async () => {
    const res = await verify.POST(post({ reference: REF }));
    expect(res.status).toBe(404);
    expect(verifyByRef).not.toHaveBeenCalled();
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
  it("a reference that is not a coin deposit (an AI top-up) is refused", async () => {
    expect((await verify.POST(post({ reference: "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111" }))).status).toBe(400);
  });
  it("the member's own reference: Flutterwave is asked, and a pending payment stays pending (the redirect proves nothing)", async () => {
    db.tables.ai_topup_attempts![0]!.user_id = ME;
    verifyByRef.mockResolvedValue({ provider: "flutterwave", reference: REF, externalId: "1", status: "pending", amountMinor: null, currency: null, channel: null, paidAt: null, reason: null });
    const res = await verify.POST(post({ reference: REF }));
    expect(await res.json()).toEqual({ status: "pending" });
    expect(verifyByRef).toHaveBeenCalledWith(REF);
    expect(db.rpc.settle_coin_deposit).not.toHaveBeenCalled();
  });
});
