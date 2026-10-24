import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2 — the return from a Flutterwave checkout. The browser comes back with
 * ?status=successful&tx_ref=…&transaction_id=… and the page posts the reference here. Nothing the
 * browser says can grant anything: the server asks Flutterwave about OUR reference and credits only
 * a verified success that matches the attempt row, for the session's own member.
 */

let db: FakeDb;
let sessionUser: { id: string; email: string } | null;
let apiAnswer: (ref: string) => VerifiedCharge;
const credits: string[] = [];
const paystackVerify = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ aiJobReadLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({ ...(await orig<typeof import("@/lib/paystack/paystack")>()), paystackEnabled: async () => true, verifyTransaction: paystackVerify }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/client")>()), verifyFlutterwaveByReference: async (ref: string) => apiAnswer(ref) }));
vi.mock("@/lib/ai/character-replace/recharge-server", () => ({
  creditVerifiedCharacterReplaceRecharge: async (o: { reference: string }) => (credits.push(o.reference), { balanceAfterCents: 100, credits: 100, bonusCredits: 0 }),
  announceCharacterReplaceRecharge: async () => {},
}));
vi.mock("@/lib/ai/wallet/paystack-settle", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/wallet/paystack-settle")>()), settleUnpaidTopup: async () => {} }));

process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";

const { POST } = await import("./route");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REF = "frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-111111111111";
const charge = (status: VerifiedCharge["status"]): VerifiedCharge => ({ provider: "flutterwave", reference: REF, externalId: "77", status, amountMinor: 1000, currency: "USD", channel: "card", paidAt: null, reason: null });
// everything a browser could add — none of it is read
const post = (body: Record<string, unknown>) => POST(new Request("https://frenzsave.com/api/ai/balance/topup/verify?status=successful&transaction_id=77", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [{ reference: REF, user_id: OWNER, provider: "flutterwave", purpose: "wallet_topup", status: "pending", amount_cents: 1000, currency: "USD", provider_amount: 1000, provider_currency: "USD", item_id: "pack_100", checkout_url: "https://checkout.flutterwave.com/x", created_at: new Date().toISOString() }] });
  sessionUser = { id: OWNER, email: "a@b.co" };
  credits.length = 0;
  paystackVerify.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("returning from Flutterwave (verify-on-return)", () => {
  it("🔴 the browser says 'successful' but Flutterwave says pending → not credited, shown as still confirming", async () => {
    apiAnswer = () => charge("pending");
    const res = await post({ reference: REF, status: "successful", transaction_id: "77", amount: 999999, credited: true });
    expect(await res.json()).toEqual({ credited: false, pending: true });
    expect(credits).toEqual([]);
  });

  it("a verified success for the session's own attempt credits (the same once-only settle as the webhook)", async () => {
    apiAnswer = () => charge("success");
    const res = await post({ reference: REF });
    expect(await res.json()).toMatchObject({ credited: true, creditsAdded: 100 });
    expect(credits).toEqual([REF]);
  });

  it("someone else's reference credits nothing, even when it was paid", async () => {
    sessionUser = { id: OTHER, email: "x@y.co" };
    apiAnswer = () => charge("success");
    expect(await (await post({ reference: REF })).json()).toEqual({ credited: false, pending: false });
    expect(credits).toEqual([]);
  });

  it("a Flutterwave reference never reaches the Paystack verify", async () => {
    apiAnswer = () => charge("success");
    await post({ reference: REF });
    expect(paystackVerify).not.toHaveBeenCalled();
  });

  it("Flutterwave unreachable → still confirming, never 'failed'", async () => {
    apiAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    expect(await (await post({ reference: REF })).json()).toEqual({ credited: false, pending: true });
    expect(credits).toEqual([]);
  });

  it("signed out → 401, nothing asked", async () => {
    sessionUser = null;
    expect((await post({ reference: REF })).status).toBe(401);
  });
});

describe("the return pages read the reference only", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("both wallet return readers accept Flutterwave's tx_ref and strip status/transaction_id without using them", () => {
    for (const f of ["lib/ai/character-replace/client.ts", "features/ai/frenz-ai-dashboard.tsx"]) {
      const src = read(f);
      expect(src, f).toContain('params.get("reference") ?? params.get("trxref") ?? params.get("tx_ref")');
      expect(src, f).toContain('for (const k of ["trxref", "tx_ref", "transaction_id", "status"]) params.delete(k);');
      expect(src, f).not.toMatch(/params\.get\("(status|transaction_id)"\)/);
    }
  });
  it("the verify route reads nothing from the body but the reference", () => {
    const route = read("app/api/ai/balance/topup/verify/route.ts");
    expect(route).toContain("const reference = (body as { reference?: unknown })?.reference;");
    expect(route).not.toMatch(/body as \{[^}]*(status|amount|transaction_id|credited)/);
  });
});
