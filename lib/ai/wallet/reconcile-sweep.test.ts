import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedCharge } from "@/lib/payments/charge";
import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 3 — the scheduled wallet top-up sweep, both rails. The REAL reconciler, the real Paystack settle
 * (resolveCredit) and the real Flutterwave settle (exact match) over an in-memory database. Scripted: the
 * two providers' verify calls (no network) and the SQL credit, modelled as credit_product_balance behaves
 * — once per reference — so a duplicate can be counted.
 */

let db: FakeDb;
let paystackAnswer: (ref: string) => unknown;
let flutterwaveAnswer: (ref: string) => VerifiedCharge;
const verifyCalls: string[] = [];
const credited = new Map<string, number>();
let creditCalls = 0;

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
/**
 * The in-memory fake hands back its LIVE row objects; a real query returns a snapshot. Copy what a query
 * returns, so a row read by one sweep does not change under it when another sweep claims it.
 */
function snapshotClient(c: ReturnType<FakeDb["client"]>) {
  const wrap = (b: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(b, {
      get(target, p) {
        if (p === "then") return (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => (target.then as (a: (r: { data: unknown }) => unknown, b?: unknown) => Promise<unknown>)((r) => res({ ...r, data: r.data ? structuredClone(r.data) : r.data }), rej);
        const v = target[p as string];
        return typeof v === "function" ? (...a: unknown[]) => {
          const out = (v as (...x: unknown[]) => unknown).apply(target, a);
          return out === target ? wrap(target) : out;
        } : v;
      },
    });
  const client = c as unknown as { from: (t: string) => Record<string, unknown>; rpc: unknown };
  return { ...client, from: (t: string) => wrap(client.from(t)) };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => snapshotClient(db.client()) }));
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiCurrency: "USD", frenzAiPlans: { credits: { centsPerCredit: 10 }, wallet: { packs: [], custom: { enabled: true, minCredits: 1, maxCredits: 1e6 } } } }) }));
vi.mock("@/lib/paystack/paystack", async (orig) => ({
  ...(await orig<typeof import("@/lib/paystack/paystack")>()),
  paystackEnabled: async () => true,
  verifyTransaction: async (ref: string) => (verifyCalls.push(`paystack:${ref}`), paystackAnswer(ref)),
}));
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  verifyFlutterwaveByReference: async (ref: string) => (verifyCalls.push(`flutterwave:${ref}`), flutterwaveAnswer(ref)),
}));
vi.mock("@/lib/ai/character-replace/recharge-server", () => ({
  creditVerifiedCharacterReplaceRecharge: async (o: { reference: string; amountCents: number }) => {
    creditCalls += 1;
    if (!credited.has(o.reference)) credited.set(o.reference, o.amountCents / 10);
    return { balanceAfterCents: 0, credits: o.amountCents / 10, bonusCredits: 0 };
  },
  announceCharacterReplaceRecharge: async (o: { reference: string }) => {
    // the real one marks the attempt success (markTopupAttempt)
    const r = db.tables.ai_topup_attempts!.find((x) => x.reference === o.reference);
    if (r) r.status = "success";
  },
}));
vi.mock("@/lib/ai/topup-notify", () => ({ notifyTopupFailed: async () => {}, notifyTopupCancelled: async () => {}, notifyTopupSuccess: async () => {} }));
vi.mock("@/lib/admin/funding-alerts", () => ({ flushFundingAlertsSoon: () => {} }));

process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-k";

const { reconcilePendingTopups, reconcileTopupAttempt } = await import("./reconcile-topups");
const { settleFlutterwaveTopup } = await import("./flutterwave-settle");

const USER = "11111111-1111-4111-8111-111111111111";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const PS = (n: number) => `frenz_cr_topup_2b1c8f8e-1111-4111-8111-${String(n).padStart(12, "0")}`;
const FW = (n: number) => `frenz_cr_topup_fw_2b1c8f8e-1111-4111-8111-${String(n).padStart(12, "0")}`;
function attempt(reference: string, provider: string, over: Record<string, unknown> = {}) {
  // an id like every real row (the in-memory fake matches updated rows by id)
  return { id: reference, reference, user_id: USER, provider, purpose: "wallet_topup", status: "pending", amount_cents: 1000, currency: "USD", provider_amount: provider === "flutterwave" ? 1000 : 1_500_000, provider_currency: provider === "flutterwave" ? "USD" : "NGN", item_id: "pack_100", checkout_url: "https://checkout.example/x", created_at: ago(20 * 60_000), updated_at: ago(20 * 60_000), ...over };
}
const paystackSuccess = (ref: string, over: Record<string, unknown> = {}) => ({ reference: ref, status: "success", amount: 1_500_000, currency: "NGN", metadata: { user_id: USER, purpose: "frenz_cr_topup", ai_topup_cents: 1000, wallet_currency: "USD", charged_currency: "NGN", fx_minor_per_usd: 150_000 }, ...over });
const fwSuccess = (ref: string, over: Partial<VerifiedCharge> = {}): VerifiedCharge => ({ provider: "flutterwave", reference: ref, externalId: "9", status: "success", amountMinor: 1000, currency: "USD", channel: "card", paidAt: null, reason: null, ...over });
const row = (ref: string) => db.tables.ai_topup_attempts!.find((r) => r.reference === ref)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db = fakeDb({ ai_topup_attempts: [] });
  verifyCalls.length = 0;
  credited.clear();
  creditCalls = 0;
  paystackAnswer = (ref) => paystackSuccess(ref);
  flutterwaveAnswer = (ref) => fwSuccess(ref);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the scheduled wallet sweep — each attempt asked of ITS OWN provider", () => {
  it("1 · a pending Paystack top-up that later succeeded is credited (once) and closed", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(1), "paystack"));
    const s = await reconcilePendingTopups();
    await flush();
    expect(s).toMatchObject({ examined: 1, settled: 1 });
    expect(verifyCalls).toEqual([`paystack:${PS(1)}`]);
    expect(credited.get(PS(1))).toBe(100);
    expect(row(PS(1)).status).toBe("success");
  });

  it("2 · a pending Flutterwave top-up that later succeeded is credited — asked of Flutterwave, not Paystack", async () => {
    db.tables.ai_topup_attempts!.push(attempt(FW(2), "flutterwave"));
    const s = await reconcilePendingTopups();
    await flush();
    expect(s).toMatchObject({ settled: 1 });
    expect(verifyCalls).toEqual([`flutterwave:${FW(2)}`]);
    expect(credited.get(FW(2))).toBe(100);
  });

  it("3 · a verify that fails (timeout / 5xx) proves nothing: the attempt stays open, nothing credited", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(3), "paystack"));
    paystackAnswer = () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    const s = await reconcilePendingTopups();
    expect(s).toMatchObject({ examined: 1, verificationFailed: 1, settled: 0 });
    expect(row(PS(3)).status).toBe("pending");
    expect(credited.size).toBe(0);
  });

  it("4 · wrong member, wrong reference, wrong currency or amount → no value, held as a mismatch for review", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(41), "paystack"), attempt(PS(42), "paystack"), attempt(PS(43), "paystack"), attempt(FW(44), "flutterwave"), attempt(FW(45), "flutterwave"));
    paystackAnswer = (ref) =>
      ref === PS(41) ? paystackSuccess(ref, { metadata: { ...paystackSuccess(ref).metadata, user_id: "someone-else" } })
      : ref === PS(42) ? paystackSuccess(ref, { reference: PS(99) })
      : paystackSuccess(ref, { currency: "GHS" });
    flutterwaveAnswer = (ref) => (ref === FW(44) ? fwSuccess(ref, { amountMinor: 1001 }) : fwSuccess(ref, { currency: "NGN" }));
    const s = await reconcilePendingTopups();
    expect(s).toMatchObject({ examined: 5, mismatched: 5, settled: 0 });
    expect(credited.size).toBe(0);
    for (const r of [PS(41), PS(42), PS(43), FW(44), FW(45)]) expect(row(r).status, r).toBe("mismatch");
  });

  it("5 · running the sweep again does not credit again (the row is closed; the credit is once per reference anyway)", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(5), "paystack"));
    await reconcilePendingTopups();
    await flush();
    row(PS(5)).status = "pending"; // even if the close were lost…
    row(PS(5)).updated_at = ago(20 * 60_000);
    await reconcilePendingTopups();
    await flush();
    expect(credited.size).toBe(1);
    expect(credited.get(PS(5))).toBe(100);
  });

  it("6 · the webhook settled it first: the cron's pass credits nothing more", async () => {
    db.tables.ai_topup_attempts!.push(attempt(FW(6), "flutterwave"));
    await settleFlutterwaveTopup(FW(6), { charge: fwSuccess(FW(6)) }); // the webhook's settle
    row(FW(6)).updated_at = ago(20 * 60_000);
    await reconcilePendingTopups();
    await flush();
    expect(credited.size).toBe(1);
  });

  it("6b · two sweeps at once work each attempt once (compare-and-set claim)", async () => {
    for (let i = 0; i < 4; i++) db.tables.ai_topup_attempts!.push(attempt(PS(60 + i), "paystack"));
    const [a, b] = await Promise.all([reconcilePendingTopups(), reconcilePendingTopups()]);
    expect(a.settled + b.settled).toBe(4);
    expect(a.skipped + b.skipped).toBe(4);
    expect(verifyCalls).toHaveLength(4);
  });

  it("8 · a terminal failed transaction grants nothing, is closed, and is never asked again", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(8), "paystack"));
    paystackAnswer = (ref) => paystackSuccess(ref, { status: "failed", gateway_response: "Declined" });
    const s = await reconcilePendingTopups();
    expect(s).toMatchObject({ failed: 1 });
    expect(credited.size).toBe(0);
    expect(row(PS(8)).status).toBe("failed");
    row(PS(8)).updated_at = ago(20 * 60_000);
    await reconcilePendingTopups();
    expect(verifyCalls).toHaveLength(1);
  });

  it("an unknown Paystack checkout (no link) that Paystack never created is closed; one still pending stays held", async () => {
    db.tables.ai_topup_attempts!.push(attempt(PS(70), "paystack", { status: "verification_required", checkout_url: null }), attempt(PS(71), "paystack", { status: "verification_required", checkout_url: null }));
    const { PaystackHttpError } = await import("@/lib/paystack/paystack");
    paystackAnswer = (ref) => {
      if (ref === PS(70)) throw new PaystackHttpError("Transaction reference not found", 400);
      return paystackSuccess(ref, { status: "pending" });
    };
    const s = await reconcilePendingTopups();
    expect(s).toMatchObject({ failed: 1, pending: 1 });
    expect(row(PS(70)).status).toBe("failed");
    expect(row(PS(71)).status).toBe("verification_required");
  });

  it("14 · bounded: at most `limit` per run, oldest first; one provider failing never stops the others", async () => {
    for (let i = 0; i < 25; i++) db.tables.ai_topup_attempts!.push(attempt(PS(100 + i), "paystack", { created_at: ago((30 + i) * 60_000) }));
    paystackAnswer = (ref) => {
      if (ref === PS(124)) throw new Error("boom"); // the oldest one
      return paystackSuccess(ref);
    };
    const s = await reconcilePendingTopups({ limit: 20 });
    expect(s.examined).toBe(20);
    expect(s).toMatchObject({ settled: 19, verificationFailed: 1 });
  });

  it("recent attempts (under 2 min), recently asked ones, terminal ones and other purposes are not swept", async () => {
    db.tables.ai_topup_attempts!.push(
      attempt(PS(201), "paystack", { created_at: ago(30_000), updated_at: ago(30_000) }),
      attempt(PS(202), "paystack", { updated_at: ago(60_000) }),
      attempt(PS(203), "paystack", { status: "success" }),
      attempt(PS(204), "paystack", { status: "mismatch" }),
      attempt("frenz_ad_x", "paystack", { purpose: "ad_campaign" }),
    );
    expect((await reconcilePendingTopups()).examined).toBe(0);
    expect(verifyCalls).toEqual([]);
  });

  it("15 · Bachs history is never selected, asked or settled", async () => {
    db.tables.ai_topup_attempts!.push(attempt("frenz_bachs_topup_1", "bachs"));
    expect((await reconcilePendingTopups()).examined).toBe(0);
    expect(await reconcileTopupAttempt({ ...attempt("frenz_bachs_topup_1", "bachs") } as never, { claimed: true })).toBe("skipped");
    expect(verifyCalls).toEqual([]);
  });

  it("the provider is the row's: a Flutterwave-shaped reference recorded as Paystack is never sent to Paystack", async () => {
    db.tables.ai_topup_attempts!.push(attempt(FW(300), "paystack"));
    const s = await reconcilePendingTopups();
    expect(s).toMatchObject({ mismatched: 1 });
    expect(verifyCalls).toEqual([]);
  });
});

