import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Coin Part 4.2 — the transaction-PIN routes over an in-memory database (the SQL rules are proven in
 * supabase/tests/0282_coin_pin.pglite.mjs). Pinned: the session is the member; setup needs a confirmed email; the reset
 * request answers the SAME whatever happened (a code issued, no PIN, a limit, no confirmed address) and emails only
 * what the database issued, to the session's confirmed address; no PIN or code is ever echoed or logged.
 */
let db: FakeDb;
let sessionUser: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
const emails: { to: string; intro: string }[] = [];
const logs: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => {
  const open = { limit: async () => ({ success: true }) };
  return { pinLimiter: open, otpLimiter: open, clientId: () => "203.0.113.9" };
});
vi.mock("@/lib/landing/settings", async () => {
  const { COIN_DEFAULTS } = await import("@/lib/coin/config");
  return { getLandingSettings: async () => ({ frenzCoin: COIN_DEFAULTS }) };
});
vi.mock("@/lib/email/resend", () => ({ hasResend: true, sendProductEmail: vi.fn(async (to: string, o: { intro: string }) => (emails.push({ to, intro: o.intro }), true)) }));

const PEPPER = "pin-route-test-pepper-0123456789abcdef012345";
const setup = await import("./route");
const reset = await import("./reset/route");
const confirm = await import("./reset/confirm/route");
const change = await import("./change/route");
const ME = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) => new Request("https://frenzsave.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("FRENZ_COIN_PIN_PEPPER", PEPPER);
  sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
  db = fakeDb({});
  emails.length = 0;
  logs.length = 0;
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a)));
  db.rpc.set_coin_pin = vi.fn(() => ({ data: { ok: true }, error: null }));
  db.rpc.coin_pin_status = vi.fn(() => ({ data: { set: true, locked_until: null }, error: null }));
  db.rpc.request_coin_pin_reset = vi.fn(() => ({ data: { ok: true, issued: true, expires_minutes: 10 }, error: null }));
  db.rpc.complete_coin_pin_reset = vi.fn(() => ({ data: { ok: false, reason: "invalid" }, error: null }));
  db.rpc.begin_coin_pin_attempt = vi.fn(() => ({ data: { ok: false, reason: "no_pin" }, error: null }));
});

describe("PIN setup and status", () => {
  it("signed out: 401 everywhere, nothing asked", async () => {
    sessionUser = null;
    for (const res of [await setup.GET(), await setup.POST(post({ pin: "482915", confirm: "482915" })), await reset.POST(post({})), await confirm.POST(post({ code: "12345678", pin: "482915", confirm: "482915" })), await change.POST(post({ currentPin: "482915", pin: "193746", confirm: "193746" }))]) {
      expect(res.status).toBe(401);
    }
    expect(db.rpc.set_coin_pin).not.toHaveBeenCalled();
    expect(db.rpc.request_coin_pin_reset).not.toHaveBeenCalled();
  });
  it("sets a PIN for the session member — the PIN is never echoed", async () => {
    const res = await setup.POST(post({ pin: "482915", confirm: "482915" }));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("482915");
    expect((db.rpc.set_coin_pin as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ p_user: ME });
  });
  it("an unconfirmed email cannot set a PIN; a body naming a user is refused", async () => {
    sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: null };
    expect((await setup.POST(post({ pin: "482915", confirm: "482915" }))).status).toBe(403);
    sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
    expect((await setup.POST(post({ pin: "482915", confirm: "482915", userId: "someone" }))).status).toBe(400);
    expect(db.rpc.set_coin_pin).not.toHaveBeenCalled();
  });
  it("status is the member's own and never a hash; no pepper reads as unavailable", async () => {
    expect(await (await setup.GET()).json()).toEqual({ available: true, set: true, lockedUntil: null });
    vi.stubEnv("FRENZ_COIN_PIN_PEPPER", "");
    expect(await (await setup.GET()).json()).toEqual({ available: false, set: false, lockedUntil: null });
  });
});

describe("PIN reset", () => {
  it("issued: the code is emailed to the session's CONFIRMED address only, and the answer is generic", async () => {
    const res = await reset.POST(post({}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toBe("me@t.test");
    const code = /(\d{8})/.exec(emails[0]!.intro)![1]!;
    expect(JSON.stringify(body)).not.toContain(code);
    expect(logs.join("\n")).not.toContain(code);
    expect(JSON.stringify((db.rpc.request_coin_pin_reset as ReturnType<typeof vi.fn>).mock.calls[0]![0])).not.toContain(code);
  });
  it("🔴 not issued (no PIN / a limit), an unconfirmed address, no address: the SAME response, nothing emailed", async () => {
    const issued = await (await reset.POST(post({}))).json();
    emails.length = 0;
    db.rpc.request_coin_pin_reset = vi.fn(() => ({ data: { ok: true, issued: false }, error: null }));
    const notIssued = await (await reset.POST(post({}))).json();
    sessionUser = { id: ME, email: "me@t.test", email_confirmed_at: null };
    const unconfirmed = await (await reset.POST(post({}))).json();
    sessionUser = { id: ME, email: null, email_confirmed_at: null };
    const noAddress = await (await reset.POST(post({}))).json();
    expect(notIssued).toEqual(issued);
    expect(unconfirmed).toEqual(issued);
    expect(noAddress).toEqual(issued);
    expect(emails).toEqual([]);
  });
  it("confirm: a wrong / used / expired code is one answer, and the new PIN is never echoed", async () => {
    const res = await confirm.POST(post({ code: "12345678", pin: "193746", confirm: "193746" }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ reason: "invalid_code" });
    expect(text).not.toMatch(/12345678|193746/);
  });
  it("change: with no PIN set it is the generic refusal", async () => {
    const res = await change.POST(post({ currentPin: "482915", pin: "193746", confirm: "193746" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "authorization_failed" });
  });
});
