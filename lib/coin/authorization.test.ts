import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4.2 — the REAL authorization module (only `server-only` and the database client are replaced). A
 * transfer proof exists only as one counted PIN attempt begun in the database plus the key derived from the PIN; the
 * database then checks it (supabase/tests/0282_coin_pin.pglite.mjs). Pinned: everything that is not that fails closed.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";
const { authorizeCoinTransfer, isCoinTransferAuthorized } = await import("./authorization");
const { COIN_DEFAULTS } = await import("./config");
const U = "11111111-1111-4111-8111-111111111111";
const SALT = "00112233445566778899aabbccddeeff";
const PARAMS = { algorithm: "scrypt", N: 1024, r: 8, p: 1, keylen: 32, pepper: "v1" };

beforeEach(() => {
  vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
  db = fakeDb({});
  db.rpc.begin_coin_pin_attempt = vi.fn(() => ({ data: { ok: true, attempt_id: "att-1", salt: SALT, params: PARAMS }, error: null }));
});

describe("authorizeCoinTransfer", () => {
  it("a well-formed PIN begins ONE counted attempt and yields a proof bound to that member", async () => {
    const out = await authorizeCoinTransfer(U, "482915", COIN_DEFAULTS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(db.rpc.begin_coin_pin_attempt).toHaveBeenCalledWith({ p_user: U, p_purpose: "transfer", p_policy: COIN_DEFAULTS.pin });
    expect(out.authorization).toMatchObject({ userId: U, attemptId: "att-1", method: "transaction_pin" });
    expect(out.authorization.keyHex).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(out.authorization)).not.toContain("482915");
    expect(isCoinTransferAuthorized(out.authorization, U)).toBe(true);
    expect(isCoinTransferAuthorized(out.authorization, "someone-else")).toBe(false);
  });
  it("no pepper configured: unavailable, and nothing is asked of the database", async () => {
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect(await authorizeCoinTransfer(U, "482915", COIN_DEFAULTS)).toEqual({ ok: false, reason: "unavailable" });
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "too-short");
    expect(await authorizeCoinTransfer(U, "482915", COIN_DEFAULTS)).toEqual({ ok: false, reason: "unavailable" });
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
  it("a malformed PIN (a 4-digit quick-lock PIN, letters, an object) is refused before the database", async () => {
    for (const pin of ["1234", "12345a", "", undefined, { pin: "482915" }, "4829150"]) {
      expect(await authorizeCoinTransfer(U, pin, COIN_DEFAULTS)).toEqual({ ok: false, reason: "authorization_failed" });
    }
    expect(db.rpc.begin_coin_pin_attempt).not.toHaveBeenCalled();
  });
  it("no PIN set, or locked: the same refusal (nothing says which)", async () => {
    for (const reason of ["no_pin", "locked"]) {
      db.rpc.begin_coin_pin_attempt = vi.fn(() => ({ data: { ok: false, reason }, error: null }));
      expect(await authorizeCoinTransfer(U, "482915", COIN_DEFAULTS)).toEqual({ ok: false, reason: "authorization_failed" });
    }
  });
  it("the database unavailable or 0282 missing: unavailable (fail closed)", async () => {
    db.rpc.begin_coin_pin_attempt = vi.fn(() => ({ data: null, error: { message: "function begin_coin_pin_attempt does not exist" } }));
    expect(await authorizeCoinTransfer(U, "482915", COIN_DEFAULTS)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("a look-alike object is not a proof", () => {
    for (const forged of [null, undefined, "u1", { userId: U, attemptId: "att-1", keyHex: "\\x00", method: "transaction_pin" }]) {
      expect(isCoinTransferAuthorized(forged, U)).toBe(false);
    }
  });
});
