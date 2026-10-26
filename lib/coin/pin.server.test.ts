import { createHmac, scryptSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4.2 — lib/coin/pin.ts over an in-memory database. The SQL functions are scripted at their documented
 * answers (their rules — counted attempts, locks, single-use codes, concurrency — are proven against real PostgreSQL in
 * supabase/tests/0282_coin_pin.pglite.mjs and coin_pin_concurrency.pg.mjs). Pinned here: what the server sends the
 * database (a scrypt hash of HMAC(pepper, PIN) — never the PIN), the format rules, the generic answers, and that no PIN
 * or reset code ever reaches a log line or a stored value.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
const PEPPER = "unit-test-pepper-0123456789abcdef0123456789ab";
const pin = await import("./pin");
const { COIN_DEFAULTS } = await import("./config");
const U = "11111111-1111-4111-8111-111111111111";
const logs: string[] = [];

beforeEach(() => {
  vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
  db = fakeDb({});
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a)));
  db.rpc.set_coin_pin = vi.fn(() => ({ data: { ok: true }, error: null }));
});
afterEach(() => {
  // 🔴 nothing secret in any log line, whatever a test did
  for (const secret of ["482915", "193746"]) expect(logs.join("\n")).not.toContain(secret);
});

describe("the PIN format (the server decides)", () => {
  it("exactly six digits", () => {
    for (const bad of ["12345", "1234567", "12345a", " 482915", "", null, 482915, "４８２９１５"]) expect(pin.pinProblem(bad)).toBe("format");
    expect(pin.pinProblem("482915")).toBeNull();
  });
  it("not one digit repeated or a straight run (what an attacker tries first)", () => {
    for (const weak of ["000000", "999999", "123456", "234567", "890123", "654321", "210987"]) expect(pin.pinProblem(weak)).toBe("too_simple");
    for (const ok of ["112233", "135790", "482915", "102938"]) expect(pin.pinProblem(ok)).toBeNull();
  });
});

describe("the hash", () => {
  it("is scrypt(HMAC-SHA256(pepper, user + PIN), salt) with stored parameters — deterministic, salted, user-bound", async () => {
    const h = await pin.hashNewPin("482915", U, PEPPER);
    expect(h.params).toEqual({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
    expect(h.salt).toHaveLength(16);
    const expected = scryptSync(createHmac("sha256", PEPPER).update(`frenz-coin-pin:${U}:482915`).digest(), h.salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 });
    expect(h.hash.equals(expected)).toBe(true);
    expect((await pin.derivePinKey("482915", h.salt, U, h.params, PEPPER)).equals(h.hash)).toBe(true);
    expect((await pin.derivePinKey("482916", h.salt, U, h.params, PEPPER)).equals(h.hash)).toBe(false);
    // another member, another pepper or another salt: another key
    expect((await pin.derivePinKey("482915", h.salt, "22222222-2222-4222-8222-222222222222", h.params, PEPPER)).equals(h.hash)).toBe(false);
    expect((await pin.derivePinKey("482915", h.salt, U, h.params, PEPPER + "x")).equals(h.hash)).toBe(false);
    expect((await pin.hashNewPin("482915", U, PEPPER)).hash.equals(h.hash)).toBe(false);
  });
  it("needs a pepper of at least 32 characters", () => {
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect(pin.pinPepper()).toBeNull();
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "x".repeat(31));
    expect(pin.pinPepper()).toBeNull();
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
    expect(pin.pinPepper()).toBe(PEPPER);
  });
});

describe("setCoinPin", () => {
  it("sends the database a hash, a salt and the parameters — never the PIN", async () => {
    expect(await pin.setCoinPin(U, "482915", "482915")).toEqual({ ok: true });
    const args = (db.rpc.set_coin_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args.p_user).toBe(U);
    expect(String(args.p_hash)).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(String(args.p_salt)).toMatch(/^\\x[0-9a-f]{32}$/);
    expect(JSON.stringify(args)).not.toContain("482915");
  });
  it.each([
    ["a malformed PIN", "48291", "48291", "format"],
    ["a too-simple PIN", "123456", "123456", "too_simple"],
    ["a confirmation that differs", "482915", "482916", "mismatch"],
  ])("%s is refused before the database", async (_why, a, b, reason) => {
    expect(await pin.setCoinPin(U, a, b)).toMatchObject({ ok: false, status: 400, reason });
    expect(db.rpc.set_coin_pin).not.toHaveBeenCalled();
  });
  it("an existing PIN is never silently replaced", async () => {
    db.rpc.set_coin_pin = vi.fn(() => ({ data: { ok: false, reason: "exists" }, error: null }));
    expect(await pin.setCoinPin(U, "482915", "482915")).toMatchObject({ ok: false, status: 409, reason: "exists" });
  });
  it("unconfirmed email or a suspended account: refused by the database, said plainly", async () => {
    for (const reason of ["email_unconfirmed", "suspended"]) {
      db.rpc.set_coin_pin = vi.fn(() => ({ data: { ok: false, reason }, error: null }));
      expect(await pin.setCoinPin(U, "482915", "482915")).toMatchObject({ ok: false, status: 403, reason });
    }
  });
  it("no pepper: unavailable, nothing written", async () => {
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect(await pin.setCoinPin(U, "482915", "482915")).toMatchObject({ ok: false, status: 503 });
    expect(db.rpc.set_coin_pin).not.toHaveBeenCalled();
  });
});

describe("changeCoinPin", () => {
  let current: { hash: Buffer; salt: Buffer; params: object };
  beforeEach(async () => {
    current = await pin.hashNewPin("482915", U, PEPPER);
    db.rpc.begin_coin_pin_attempt = vi.fn(() => ({ data: { ok: true, attempt_id: "att-1", salt: current.salt.toString("hex"), params: current.params }, error: null }));
    // change_coin_pin, modelled: the current key must equal the stored hash
    db.rpc.change_coin_pin = vi.fn((a: Record<string, unknown>) => ({ data: { ok: a.p_current === `\\x${current.hash.toString("hex")}` }, error: null }));
  });
  it("the current PIN (a counted 'change' attempt) unlocks a change to a new PIN", async () => {
    expect(await pin.changeCoinPin(U, "482915", "193746", "193746", COIN_DEFAULTS)).toEqual({ ok: true });
    expect(db.rpc.begin_coin_pin_attempt).toHaveBeenCalledWith({ p_user: U, p_purpose: "change", p_policy: COIN_DEFAULTS.pin });
    const args = (db.rpc.change_coin_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args.p_attempt).toBe("att-1");
    expect(JSON.stringify(args)).not.toMatch(/482915|193746/);
  });
  it("a wrong current PIN: refused with the generic answer", async () => {
    expect(await pin.changeCoinPin(U, "111222", "193746", "193746", COIN_DEFAULTS)).toMatchObject({ ok: false, status: 403, reason: "authorization_failed" });
  });
  it("a bad new PIN or a mismatch never spends an attempt", async () => {
    expect(await pin.changeCoinPin(U, "482915", "123456", "123456", COIN_DEFAULTS)).toMatchObject({ reason: "too_simple" });
    expect(await pin.changeCoinPin(U, "482915", "193746", "193747", COIN_DEFAULTS)).toMatchObject({ reason: "mismatch" });
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
});

describe("the email reset", () => {
  it("request: the code is 8 CSPRNG digits; only its HMAC goes to the database; it is emailed only when issued", async () => {
    db.rpc.request_coin_pin_reset = vi.fn(() => ({ data: { ok: true, issued: true, expires_minutes: 10 }, error: null }));
    const send = vi.fn(async (_code: string, _minutes: number) => true);
    expect(await pin.requestCoinPinReset(U, COIN_DEFAULTS, send)).toEqual({ ok: true });
    const [code, minutes] = send.mock.calls[0]!;
    expect(code).toMatch(/^[0-9]{8}$/);
    expect(minutes).toBe(10);
    const args = (db.rpc.request_coin_pin_reset as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args.p_code_hash).toBe(`\\x${pin.resetCodeHash(code, U, PEPPER).toString("hex")}`);
    expect(JSON.stringify(args)).not.toContain(code);
    expect(logs.join("\n")).not.toContain(code);
  });
  it("request: not issued (no PIN, no confirmed email, too many) — the SAME answer, and nothing is emailed", async () => {
    db.rpc.request_coin_pin_reset = vi.fn(() => ({ data: { ok: true, issued: false }, error: null }));
    const send = vi.fn(async () => true);
    expect(await pin.requestCoinPinReset(U, COIN_DEFAULTS, send)).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });
  it("request: a failed email send is not told to the caller differently", async () => {
    db.rpc.request_coin_pin_reset = vi.fn(() => ({ data: { ok: true, issued: true, expires_minutes: 10 }, error: null }));
    expect(await pin.requestCoinPinReset(U, COIN_DEFAULTS, async () => false)).toEqual({ ok: true });
  });
  it("codes are unpredictable (a sample has no repeats) and always 8 digits", () => {
    const seen = new Set(Array.from({ length: 2_000 }, () => pin.newResetCode()));
    expect(seen.size).toBeGreaterThan(1_990);
    for (const c of seen) expect(c).toMatch(/^[0-9]{8}$/);
  });
  it("complete: the code's HMAC and a new hash go to the database; a wrong, used or old code is one answer", async () => {
    db.rpc.complete_coin_pin_reset = vi.fn(() => ({ data: { ok: true }, error: null }));
    expect(await pin.completeCoinPinReset(U, "12345678", "193746", "193746", COIN_DEFAULTS)).toEqual({ ok: true });
    const args = (db.rpc.complete_coin_pin_reset as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(args.p_code_hash).toBe(`\\x${pin.resetCodeHash("12345678", U, PEPPER).toString("hex")}`);
    expect(JSON.stringify(args)).not.toMatch(/12345678|193746/);
    db.rpc.complete_coin_pin_reset = vi.fn(() => ({ data: { ok: false, reason: "invalid" }, error: null }));
    expect(await pin.completeCoinPinReset(U, "12345678", "193746", "193746", COIN_DEFAULTS)).toMatchObject({ ok: false, reason: "invalid_code" });
    expect(await pin.completeCoinPinReset(U, "1234", "193746", "193746", COIN_DEFAULTS)).toMatchObject({ ok: false, reason: "invalid_code" });
  });
});
