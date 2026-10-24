import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Part 5 — the admin payments routes: who may read, who may recheck, what is accepted, what comes back.
 * The ledger module and the connection test are scripted (their own suites cover them).
 */

let admin: { id: string } | null;
let reauthOk: boolean;
let limited: boolean;
const list = vi.fn(async (_f: unknown) => ({ rows: [], events: [], unavailable: [] }));
const recheck = vi.fn(async (ref: string, _admin: string) => ({ ok: true, source: "sub_purchases", purpose: "sub_purchase", before: "initiated", after: "paid", outcome: "paid", ref }));
const connTest = vi.fn(async () => ({ ok: false, code: "key_rejected", mode: "live" }));
const auditRows: unknown[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/require-admin", async () => {
  const { NextResponse } = await import("next/server");
  return { requireAdminApi: async () => (admin ? { ok: true, user: admin } : { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) }) };
});
vi.mock("@/lib/admin/reauth", () => ({
  requireSensitiveAdmin: async () => (!admin ? { ok: false, response: new Response("{}", { status: 404 }) } : reauthOk ? { ok: true, user: admin } : { ok: false, response: Response.json({ error: "Confirm your password to continue.", code: "REAUTH_REQUIRED" }, { status: 403 }) }),
}));
vi.mock("@/lib/rate-limit", () => ({ subVerifyLimiter: { limit: async () => ({ success: !limited }) } }));
vi.mock("@/lib/payments/admin-transactions", () => ({ listAdminTransactions: (f: unknown) => list(f), adminRecheckPayment: (r: string, a: string) => recheck(r, a), RECONCILIATION_STATES: ["settled", "open", "needs_check", "review", "closed"] }));
vi.mock("@/lib/flutterwave/connection-test", () => ({ testFlutterwaveConnection: () => connTest(), CONNECTION_TEST_COPY: { key_rejected: "Flutterwave rejected the secret key." } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: async (row: unknown) => (auditRows.push(row), { error: null }) }) }) }));

const tx = await import("./route");
const test = await import("../test/route");
const get = (qs = "") => tx.GET(new Request(`https://frenzsave.com/api/admin/flutterwave/transactions${qs}`));
const post = (body: unknown) => tx.POST(new Request("https://frenzsave.com/api/admin/flutterwave/transactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  admin = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  reauthOk = true;
  limited = false;
  list.mockClear();
  recheck.mockClear();
  connTest.mockClear();
  auditRows.length = 0;
});

describe("GET /api/admin/flutterwave/transactions", () => {
  it("non-admins get a 404 and nothing is read", async () => {
    admin = null;
    expect((await get()).status).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });
  it("validates every filter server-side; an unknown one or a non-Frenz reference is refused", async () => {
    expect((await get("?provider=flutterwave&purpose=sub_purchase&state=needs_check&reference=frenz_sub_abc123")).status).toBe(200);
    expect(list).toHaveBeenCalledWith({ provider: "flutterwave", purpose: "sub_purchase", state: "needs_check", reference: "frenz_sub_abc123" });
    for (const bad of ["?provider=stripe", "?purpose=donation", "?state=paid", "?reference=1%27%20or%201=1", "?admin=1"]) expect((await get(bad)).status, bad).toBe(400);
  });
});

describe("POST /api/admin/flutterwave/transactions (recheck)", () => {
  it("needs a fresh password, not just an admin session", async () => {
    reauthOk = false;
    const res = await post({ reference: "frenz_sub_abc123" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    expect(recheck).not.toHaveBeenCalled();
  });
  it("🔴 accepts a reference ONLY — a body that tries to say 'paid', an amount or a status is refused outright", async () => {
    for (const body of [{ reference: "frenz_sub_abc123", status: "paid" }, { reference: "frenz_sub_abc123", amount: 100 }, { status: "success" }, {}]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(recheck).not.toHaveBeenCalled();
  });
  it("rechecks with the admin's id from the session, and is rate limited", async () => {
    const res = await post({ reference: "frenz_sub_abc123" });
    expect(res.status).toBe(200);
    expect(recheck).toHaveBeenCalledWith("frenz_sub_abc123", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    limited = true;
    expect((await post({ reference: "frenz_sub_abc123" })).status).toBe(429);
    expect(recheck).toHaveBeenCalledTimes(1);
  });
  it("a provider error inside the recheck is a generic 503 — never the provider's detail", async () => {
    recheck.mockRejectedValueOnce(new Error("Flutterwave said: Invalid authorization key FLWSECK-secret"));
    const res = await post({ reference: "frenz_sub_abc123" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("FLWSECK");
  });
});

describe("POST /api/admin/flutterwave/test (connection test)", () => {
  it("admin only; rate limited; answers fixed copy and is audited with code + mode only", async () => {
    admin = null;
    expect((await test.POST()).status).toBe(404);
    admin = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const res = await test.POST();
    expect(await res.json()).toEqual({ ok: false, code: "key_rejected", mode: "live", message: "Flutterwave rejected the secret key." });
    expect(auditRows).toEqual([expect.objectContaining({ action: "admin_flutterwave_connection_test", details: { code: "key_rejected", mode: "live" } })]);
    limited = true;
    expect((await test.POST()).status).toBe(429);
    expect(connTest).toHaveBeenCalledTimes(1);
  });
});

describe("payment routing is validated server-side (Admin → AI Plans save)", () => {
  it("the landing save runs paymentRoutingProblem over every market × purpose", () => {
    const src = readFileSync(join(process.cwd(), "app/api/admin/landing/route.ts"), "utf8");
    expect(src).toContain("const problem = paymentRoutingProblem(v);");
  });
});
