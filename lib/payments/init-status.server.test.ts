import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";
import { scriptOpenCheckoutGuard } from "@/lib/testing/open-checkout-guard";

/**
 * Part 4.1 — a checkout that could not be opened answers 503, never 502: Cloudflare replaces an
 * origin 502 with its own HTML page, so the member saw a generic error instead of ours. The REAL
 * startSubCheckout / startVerificationCheckout over an in-memory database; both providers'
 * checkout calls are scripted (no network).
 *
 *   · a definite refusal and an unknown outcome both answer 503 with the same body as before;
 *   · the fallback still follows `refusal`, not the status: Paystack only after a DEFINITE
 *     Flutterwave refusal, never after an unknown one;
 *   · a checkout that opens is unchanged.
 */

let db: FakeDb;
let fwCreate: (o: { reference: string }) => Promise<string>;
let psCreate: (o: { reference: string }) => Promise<string>;
const psCalls: string[] = [];
let psVerify: (ref: string) => Promise<Record<string, unknown>>;
const psVerifyCalls: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/landing/settings", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  const { normalizeAiWalletConfig } = await import("@/lib/ai/credits/wallet-config");
  return { getLandingSettings: async () => ({ frenzRewards: { sub: SUB_DEFAULTS }, frenzAiPlans: { wallet: normalizeAiWalletConfig(null) }, frenzAiCharacterReplace: { recharge: { checkoutCurrency: "NGN" } } }) };
});
vi.mock("@/lib/ai/character-replace/fx-rate-server", () => ({ resolveCheckoutRate: async () => ({ minorPerUsd: 160_000 }) }));
vi.mock("@/lib/paystack/paystack", async (orig) => {
  const open = (o: { reference: string }) => (psCalls.push(o.reference), psCreate(o));
  return { ...(await orig<typeof import("@/lib/paystack/paystack")>()), paystackEnabled: async () => true, initializeSubCheckout: open, initializeVerificationCheckout: open, verifyTransaction: (ref: string) => (psVerifyCalls.push(ref), psVerify(ref)) };
});
vi.mock("@/lib/flutterwave/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/flutterwave/client")>()),
  createFlutterwaveCheckout: (o: { reference: string }) => fwCreate(o),
  verifyFlutterwaveByReference: async () => {
    throw new Error("no held checkout in these tests");
  },
}));
vi.mock("@/lib/sub/notify", () => ({ notifySubscribed: vi.fn() }));
vi.mock("@/lib/sub/payout-account", () => ({ autoWithdrawSub: vi.fn() }));

const { startSubCheckout } = await import("@/lib/sub/server");
const { startVerificationCheckout } = await import("@/lib/social/paid-verification");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");
const { PaystackHttpError, PaystackNotConfiguredError } = await import("@/lib/paystack/paystack");
const { resolveUncertainAttempt } = await import("@/lib/ads-platform/payment-server");

const C = "00000000-0000-4000-8000-000000000001";
const S = "00000000-0000-4000-8000-000000000002";
const ENABLED = { FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-k", FLUTTERWAVE_SECRET_HASH: "h", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_ENABLED_PURPOSES: "sub_purchase,verification", FLUTTERWAVE_AMOUNT_UNIT: "major" };
const setFlutterwave = (on: boolean) => {
  for (const [k, v] of Object.entries(ENABLED)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
};
const timeout = () => Object.assign(new Error("aborted"), { name: "TimeoutError" });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const flows = [
  {
    name: "SUB",
    table: "sub_purchases",
    start: () => startSubCheckout({ subscriberId: S, email: "a@b.co", creatorId: C, returnPath: "/account/subscriptions" }),
  },
  {
    name: "paid verification",
    table: "verification_purchases",
    start: () => startVerificationCheckout({ userId: S, email: "a@b.co" }),
  },
] as const;

beforeEach(() => {
  db = fakeDb({
    profiles: [
      { id: C, handle: "amaka", is_suspended: false, is_hidden: false },
      { id: S, is_suspended: false, is_verified: false },
    ],
    creator_membership_settings: [{ creator_id: C, sub_price_cents: 1000, sub_active: true, setup_step: 4, setup_completed_at: ago(100), open: false, welcome: null, promo_dismissed_at: null }],
    creator_memberships: [],
    blocks: [],
    settings: [{ key: "paid_verification", value: { enabled: true, priceCents: 500, periodDays: 30 } }],
    sub_purchases: [],
    verification_purchases: [],
  });
  // what Postgres fills in: a new purchase is `initiated`
  db.defaults = { sub_purchases: { status: "initiated" }, verification_purchases: { status: "initiated" } };
  scriptOpenCheckoutGuard(db);
  psCalls.length = 0;
  psVerifyCalls.length = 0;
  psVerify = async () => {
    throw new Error("verify not scripted");
  };
  fwCreate = async (o) => `https://checkout.flutterwave.com/${o.reference}`;
  psCreate = async (o) => `https://checkout.paystack.com/${o.reference}`;
  setFlutterwave(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe.each(flows)("$name — checkout start statuses", ({ table, start }) => {
  const rows = (provider?: string) => (db.tables[table] ?? []).filter((r) => !provider || (r.provider ?? "paystack") === provider);

  it("a checkout that opens is unchanged: the hosted link, not reused", async () => {
    expect(await start()).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//), reused: false });
  });

  it("a DEFINITE Paystack refusal answers 503 (not 502) with the same safe message; the purchase is closed", async () => {
    psCreate = async () => {
      throw new PaystackHttpError("Invalid key", 401);
    };
    const r = await start();
    expect(r).toEqual({ ok: false, status: 503, error: expect.stringMatching(/couldn't open the payment/i) });
    expect(rows()[0]).toMatchObject({ status: "failed" });
  });

  it("an UNKNOWN Paystack outcome (timeout) answers 503 and stays initiated, to be resolved by its reference", async () => {
    psCreate = async () => {
      throw timeout();
    };
    expect(await start()).toMatchObject({ ok: false, status: 503 });
    expect(rows()[0]).toMatchObject({ status: "initiated" });
  });

  it("🔴 an UNKNOWN Flutterwave outcome answers 503, says it couldn't confirm, and NEVER falls back to Paystack", async () => {
    setFlutterwave(true);
    fwCreate = async () => {
      throw timeout();
    };
    const r = await start();
    expect(r).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/couldn't confirm the payment page opened/i) });
    expect(psCalls).toEqual([]);
    expect(rows("flutterwave")[0]).toMatchObject({ status: "initiated" });

    // a Flutterwave 5xx is unknown too
    db.tables[table] = [];
    fwCreate = async () => {
      throw new FlutterwaveHttpError("upstream", 503);
    };
    expect(await start()).toMatchObject({ ok: false, status: 503 });
    expect(psCalls).toEqual([]);
  });

  it("a DEFINITE Flutterwave refusal still falls back to Paystack, which opens the checkout", async () => {
    setFlutterwave(true);
    fwCreate = async () => {
      throw new FlutterwaveHttpError("Invalid currency", 400);
    };
    expect(await start()).toMatchObject({ ok: true, url: expect.stringMatching(/paystack/) });
    expect(psCalls).toHaveLength(1);
    expect(rows("flutterwave")[0]).toMatchObject({ status: "failed" });
  });

  it("both rails refused definitely: 503 with the body shape the route forwards ({ ok, status, error })", async () => {
    setFlutterwave(true);
    fwCreate = async () => {
      throw new FlutterwaveHttpError("Invalid currency", 400);
    };
    psCreate = async () => {
      throw new PaystackHttpError("Invalid key", 401);
    };
    const r = await start();
    expect(r).toEqual({ ok: false, status: 503, error: expect.any(String) });
  });
});

/**
 * Part 4.2 — a Paystack SUB checkout whose creation outcome is unknown is HELD, and is resolved
 * by its reference before any new checkout for the pair: never retried, never a second link.
 */
describe("Part 4.2 — SUB: an unresolved Paystack checkout blocks a second one", () => {
  const start = flows[0].start;
  const HELD = `frenz_sub_${"cd".repeat(16)}`;
  const held = (minutesOld: number, over: Record<string, unknown> = {}) => ({ id: "h1", reference: HELD, subscriber_id: S, creator_id: C, provider: "paystack", status: "initiated", checkout_url: null, created_at: ago(minutesOld), charged_minor: 1_760_000, charged_currency: "NGN", failure_source: null, ...over });
  const row = (ref: string) => db.tables.sub_purchases!.find((r) => r.reference === ref);
  const STILL = { ok: false, status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." };
  const notFound = () => new PaystackHttpError("Transaction reference not found", 400);

  it("a JSON Paystack 5xx at initialize is UNKNOWN now: the purchase stays initiated, never closed as failed", async () => {
    psCreate = async () => {
      throw new PaystackHttpError("An error occurred", 500);
    };
    expect(await start()).toMatchObject({ ok: false, status: 503 });
    expect(db.tables.sub_purchases![0]).toMatchObject({ status: "initiated" });
    expect(db.tables.sub_purchases![0]!.checkout_url ?? null).toBeNull();
    expect(db.writes.filter((w) => w.table === "sub_purchases" && w.op === "update")).toEqual([]);
  });

  it("🔴 a second tap right after an unknown outcome opens NO second checkout and asks Paystack nothing (the first may be mid-request)", async () => {
    psCreate = async () => {
      throw timeout();
    };
    await start();
    psCreate = async (o) => `https://checkout.paystack.com/${o.reference}`;
    for (let i = 0; i < 3; i++) expect(await start()).toEqual(STILL);
    expect(psCalls).toHaveLength(1);
    expect(psVerifyCalls).toEqual([]);
    expect(db.tables.sub_purchases).toHaveLength(1);
  });

  it("a tap while the first request is still waiting on Paystack is held; the first still gets its link", async () => {
    let release!: (url: string) => void;
    psCreate = () => new Promise<string>((r) => (release = r));
    const first = start();
    await vi.waitFor(() => expect(psCalls).toHaveLength(1));
    expect(await start()).toEqual(STILL);
    release("https://checkout.paystack.com/first");
    expect(await first).toMatchObject({ ok: true, url: "https://checkout.paystack.com/first" });
    expect(psCalls).toHaveLength(1);
  });

  it("past the grace, Paystack's own 'reference not found' closes it as never created (recoverable init_refused) and the new checkout opens", async () => {
    db.tables.sub_purchases = [held(5)];
    psVerify = async () => {
      throw notFound();
    };
    expect(await start()).toMatchObject({ ok: true, url: expect.stringMatching(/paystack/), reused: false });
    expect(row(HELD)).toMatchObject({ status: "failed", failure_source: "init_refused" });
    expect(psCalls).toHaveLength(1);
  });

  it("past the grace, a Paystack 5xx, a timeout or a missing key while asking keeps it HELD — nothing is closed, nothing new opens", async () => {
    db.tables.sub_purchases = [held(5)];
    for (const e of [new PaystackHttpError("upstream", 502), timeout(), new PaystackNotConfiguredError()]) {
      psVerify = async () => {
        throw e;
      };
      expect(await start()).toEqual(STILL);
    }
    expect(row(HELD)).toMatchObject({ status: "initiated" });
    expect(psCalls).toEqual([]);
  });

  it("a held checkout Paystack shows PAID settles through the existing settle and tells the member — no second checkout", async () => {
    db.tables.sub_purchases = [held(5)];
    const settle = vi.fn(() => ({ data: { ok: true }, error: null }));
    db.rpc.settle_sub_purchase = settle;
    psVerify = async () => ({ status: "success", amount: 1_760_000, currency: "NGN", id: 7, metadata: { purpose: "frenz_sub" } });
    expect(await start()).toEqual({ ok: false, status: 409, error: "Your payment went through — your subscription is active." });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ p_reference: HELD }));
    expect(psCalls).toEqual([]);
  });

  it("a held checkout Paystack knows but shows unfinished stays held inside the 30-minute abandon grace; after it, closed and a new one may open", async () => {
    psVerify = async () => ({ status: "abandoned", metadata: { purpose: "frenz_sub" } });
    db.tables.sub_purchases = [held(5)];
    expect(await start()).toEqual(STILL);
    expect(psCalls).toEqual([]);

    db.tables.sub_purchases = [held(31)];
    expect(await start()).toMatchObject({ ok: true });
    expect(row(HELD)).toMatchObject({ status: "failed", failure_source: "verify_abandoned" });
  });

  it("a handed-out link under 30 minutes is still REUSED (unchanged) — no new checkout, no verify", async () => {
    db.tables.sub_purchases = [held(5, { checkout_url: "https://checkout.paystack.com/open" })];
    expect(await start()).toEqual({ ok: true, url: "https://checkout.paystack.com/open", reused: true });
    expect(psCalls).toEqual([]);
    expect(psVerifyCalls).toEqual([]);
  });

  it("paid, failed, or link-carrying older rows never block: the checkout proceeds as before", async () => {
    for (const r of [held(5, { status: "paid" }), held(5, { status: "failed", failure_source: "init_refused" }), held(45, { checkout_url: "https://checkout.paystack.com/old" })]) {
      db.tables.sub_purchases = [r];
      psCalls.length = 0;
      expect(await start()).toMatchObject({ ok: true, reused: false });
      expect(psCalls).toHaveLength(1);
    }
    expect(psVerifyCalls).toEqual([]);
  });

  it("a held Paystack checkout also blocks the FLUTTERWAVE rail (no second checkout on either rail)", async () => {
    setFlutterwave(true);
    let fwOpened = 0;
    fwCreate = async (o) => (fwOpened++, `https://checkout.flutterwave.com/${o.reference}`);
    db.tables.sub_purchases = [held(5)];
    psVerify = async () => {
      throw timeout();
    };
    expect(await start()).toEqual(STILL);
    expect(fwOpened).toBe(0);
  });

  it("Flutterwave refuses definitely, then Paystack's outcome is unknown: 503, the Paystack purchase held, nothing failed or retried", async () => {
    setFlutterwave(true);
    fwCreate = async () => {
      throw new FlutterwaveHttpError("Invalid currency", 400);
    };
    psCreate = async () => {
      throw new PaystackHttpError("upstream", 503);
    };
    expect(await start()).toMatchObject({ ok: false, status: 503 });
    expect(psCalls).toHaveLength(1);
    const ps = db.tables.sub_purchases!.find((r) => r.provider === "paystack");
    expect(ps).toMatchObject({ status: "initiated" });
  });
});

/**
 * Paid verification — the same rule as SUB: a Paystack checkout whose creation outcome is unknown
 * is HELD and resolved by its own reference before any new checkout for the member.
 */
describe("paid verification: an unresolved Paystack checkout blocks a second one", () => {
  const start = flows[1].start;
  const HELD = `frenz_vf_${"ef".repeat(16)}`;
  const held = (minutesOld: number, over: Record<string, unknown> = {}) => ({ id: "v1", reference: HELD, user_id: S, provider: "paystack", status: "initiated", checkout_url: null, created_at: ago(minutesOld), price_cents: 500, charged_minor: 800_000, charged_currency: "NGN", period_days: 30, failure_source: null, ...over });
  const row = (ref: string) => db.tables.verification_purchases!.find((r) => r.reference === ref);
  const STILL = { ok: false, status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." };
  const verified = () => (db.tables.profiles!.find((p) => p.id === S) as { is_verified: boolean }).is_verified;
  beforeEach(() => {
    db.tables.verification_requests = [];
    db.tables.verification_events = [];
  });

  it("a successful checkout is unchanged (hosted link, not reused)", async () => {
    expect(await start()).toEqual({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\/frenz_vf_/), reused: false });
    expect(psVerifyCalls).toEqual([]);
  });

  it("a Paystack 5xx, a timeout or a network drop at initialize leaves the purchase initiated, never failed", async () => {
    for (const e of [new PaystackHttpError("An error occurred", 500), timeout(), Object.assign(new TypeError("fetch failed"))]) {
      db.tables.verification_purchases = [];
      psCreate = async () => {
        throw e;
      };
      expect(await start()).toMatchObject({ ok: false, status: 503 });
      expect(db.tables.verification_purchases![0]).toMatchObject({ status: "initiated" });
      expect(db.tables.verification_purchases![0]!.checkout_url ?? null).toBeNull();
    }
  });

  it("🔴 repeated taps after an unknown outcome open NO second checkout and ask Paystack nothing inside the grace", async () => {
    psCreate = async () => {
      throw timeout();
    };
    await start();
    psCreate = async (o) => `https://checkout.paystack.com/${o.reference}`;
    for (let i = 0; i < 3; i++) expect(await start()).toEqual(STILL);
    expect(psCalls).toHaveLength(1);
    expect(psVerifyCalls).toEqual([]);
    expect(db.tables.verification_purchases).toHaveLength(1);
  });

  it("a tap while the first request is still waiting on Paystack is held; the first still gets its link", async () => {
    let release!: (url: string) => void;
    psCreate = () => new Promise<string>((r) => (release = r));
    const first = start();
    await vi.waitFor(() => expect(psCalls).toHaveLength(1));
    expect(await start()).toEqual(STILL);
    release("https://checkout.paystack.com/first");
    expect(await first).toMatchObject({ ok: true, url: "https://checkout.paystack.com/first" });
    expect(psCalls).toHaveLength(1);
  });

  it("past the grace, a 5xx, a timeout or a missing key while VERIFYING keeps it held — nothing closed, nothing new", async () => {
    db.tables.verification_purchases = [held(5)];
    for (const e of [new PaystackHttpError("upstream", 502), timeout(), new PaystackNotConfiguredError(), new Error("anything else")]) {
      psVerify = async () => {
        throw e;
      };
      expect(await start()).toEqual(STILL);
    }
    expect(row(HELD)).toMatchObject({ status: "initiated" });
    expect(psCalls).toEqual([]);
  });

  it("past the grace, Paystack's own 'reference not found' closes it as never created, and one new checkout opens", async () => {
    db.tables.verification_purchases = [held(5)];
    psVerify = async () => {
      throw new PaystackHttpError("Transaction reference not found", 400);
    };
    expect(await start()).toMatchObject({ ok: true, reused: false });
    expect(row(HELD)).toMatchObject({ status: "failed", failure_source: "initialize_unknown_never_created" });
    expect(psCalls).toHaveLength(1);
  });

  it("a held checkout Paystack shows PAID grants the tick ONCE through the existing confirm, and opens nothing", async () => {
    db.tables.verification_purchases = [held(5)];
    psVerify = async () => ({ status: "success", amount: 800_000, currency: "NGN", id: 42, metadata: { purpose: "frenz_verification", user_id: S } });
    const paid = { ok: false, status: 409, error: "Your payment went through — you're verified." };
    expect(await start()).toEqual(paid);
    expect(row(HELD)).toMatchObject({ status: "paid" });
    expect(verified()).toBe(true);
    const approvals = db.tables.verification_requests!.filter((r) => r.status === "approved").length;
    // again: the row is paid (no longer held), so the normal flow runs — and the grant is never repeated
    await start();
    expect(db.tables.verification_requests!.filter((r) => r.status === "approved").length).toBe(approvals);
    expect(psCalls.length).toBeLessThanOrEqual(1);
  });

  it("a held checkout Paystack shows unfinished stays held inside the 30-minute grace; past it, closed and a new one may open", async () => {
    psVerify = async () => ({ status: "abandoned", metadata: { purpose: "frenz_verification", user_id: S } });
    db.tables.verification_purchases = [held(5)];
    expect(await start()).toEqual(STILL);
    expect(psCalls).toEqual([]);

    db.tables.verification_purchases = [held(31)];
    expect(await start()).toMatchObject({ ok: true });
    expect(row(HELD)).toMatchObject({ status: "failed", failure_source: "verify_abandoned" });
  });

  it("a handed-out link under 30 minutes is still REUSED (unchanged) — no verify, no new checkout", async () => {
    db.tables.verification_purchases = [held(5, { checkout_url: "https://checkout.paystack.com/open" })];
    expect(await start()).toEqual({ ok: true, url: "https://checkout.paystack.com/open", reused: true });
    expect(psCalls).toEqual([]);
    expect(psVerifyCalls).toEqual([]);
  });

  it("failed, refunded, or older link-carrying rows never block: the checkout proceeds as before", async () => {
    for (const r of [held(5, { status: "failed", failure_source: "initialize_refused" }), held(5, { status: "refunded" }), held(45, { checkout_url: "https://checkout.paystack.com/old" })]) {
      db.tables.verification_purchases = [r];
      psCalls.length = 0;
      expect(await start()).toMatchObject({ ok: true, reused: false });
      expect(psCalls).toHaveLength(1);
    }
    expect(psVerifyCalls).toEqual([]);
  });

  it("a held Paystack checkout also blocks the FLUTTERWAVE rail", async () => {
    setFlutterwave(true);
    let fwOpened = 0;
    fwCreate = async (o) => (fwOpened++, `https://checkout.flutterwave.com/${o.reference}`);
    db.tables.verification_purchases = [held(5)];
    psVerify = async () => {
      throw timeout();
    };
    expect(await start()).toEqual(STILL);
    expect(fwOpened).toBe(0);
  });

  it("a held FLUTTERWAVE row is never verified with Paystack — and (0276) no Paystack checkout opens while it is recent", async () => {
    db.tables.verification_purchases = [held(5, { reference: `frenz_vf_fw_${"ab".repeat(16)}`, provider: "flutterwave", charged_currency: "USD", charged_minor: 500 })];
    expect(await start()).toEqual(STILL);
    expect(psVerifyCalls).toEqual([]);
    expect(psCalls).toEqual([]);
    // past the 30-minute window the guard no longer holds it (the Flutterwave rail's own check owns it then)
    db.tables.verification_purchases = [held(31, { reference: `frenz_vf_fw_${"ab".repeat(16)}`, provider: "flutterwave", charged_currency: "USD", charged_minor: 500 })];
    expect(await start()).toMatchObject({ ok: true });
    expect(psVerifyCalls).toEqual([]);
  });

  it("the held-check's own read failing opens nothing (503)", async () => {
    db.failOn = { verification_purchases: "connection reset" };
    const r = await start();
    expect(r).toEqual({ ok: false, status: 503, error: "Payments are unavailable right now. Try again shortly." });
    expect(psCalls).toEqual([]);
  });
});

/**
 * Part 4 closure — simultaneous FIRST requests (no rows yet: both pass the app's own read). 0276's begin_*
 * functions (modelled here; the SQL runs in lib/sub/journey.server.test.ts and supabase/tests/open_checkout_guard.pg.mjs)
 * let exactly one insert; the other is handed "being confirmed" and never reaches a provider.
 */
describe.each(flows)("$name — simultaneous requests (0276 guard)", ({ table, start }) => {
  const STILL = { ok: false, status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." };

  it("two requests at once: ONE purchase row, ONE provider checkout; the other is told it is being confirmed", async () => {
    const results = await Promise.all([start(), start()]);
    expect(db.tables[table]).toHaveLength(1);
    expect(psCalls).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual(STILL);
  });

  it("a burst of eight: still one row and one checkout", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => start()));
    expect(db.tables[table]).toHaveLength(1);
    expect(psCalls).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("an ambiguous Paystack outcome under a burst: one checkout attempt, the row held, nobody retried or fell back", async () => {
    setFlutterwave(true);
    fwCreate = async () => {
      throw timeout();
    };
    const results = await Promise.all([start(), start(), start()]);
    expect(psCalls).toEqual([]);
    expect(db.tables[table]).toHaveLength(1);
    expect(db.tables[table]![0]).toMatchObject({ status: "initiated" });
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it("the guard's conflict hands back the open link (no second checkout) when the first already has one", async () => {
    await start();
    // the reuse read is the app's first stop; skip it to reach the guard, as a request that raced past it would
    const url = db.tables[table]![0]!.checkout_url;
    db.tables[table]![0]!.created_at = ago(1);
    const rpc = (db.rpc as Record<string, (a: Record<string, unknown>) => unknown>)[table === "sub_purchases" ? "begin_sub_purchase" : "begin_verification_purchase"]!;
    const r = (await rpc(table === "sub_purchases" ? { p_subscriber: S, p_creator: C } : { p_user: S })) as { data: Record<string, unknown> };
    expect(r.data).toMatchObject({ ok: false, reason: "open", checkout_url: url });
    expect(psCalls).toHaveLength(1);
  });

  it("before 0276 is applied (function missing): the plain insert, exactly as before", async () => {
    const name = table === "sub_purchases" ? "begin_sub_purchase" : "begin_verification_purchase";
    db.rpc[name] = () => ({ data: null, error: { message: `Could not find the function public.${name} in the schema cache` } });
    expect(await start()).toMatchObject({ ok: true, reused: false });
    expect(db.tables[table]).toHaveLength(1);
  });

  it("an unexpected database error from the guard opens NOTHING (500) and tries no other rail", async () => {
    setFlutterwave(true);
    let fwOpened = 0;
    fwCreate = async (o) => (fwOpened++, `https://checkout.flutterwave.com/${o.reference}`);
    const name = table === "sub_purchases" ? "begin_sub_purchase" : "begin_verification_purchase";
    db.rpc[name] = () => ({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const r = await start();
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(fwOpened).toBe(0);
    expect(psCalls).toEqual([]);
  });

  it("a legitimate later purchase still works once the earlier one is resolved (paid / failed)", async () => {
    for (const status of ["paid", "failed"]) {
      // a paid verification carries its period end (no expires_at would be a lifetime tick, which is refused by design)
      db.tables[table] = [{ reference: `x_${status}`, subscriber_id: S, creator_id: C, user_id: S, status, created_at: ago(2), checkout_url: "https://checkout.paystack.com/old", expires_at: new Date(Date.now() + 86_400_000).toISOString() }];
      psCalls.length = 0;
      expect(await start()).toMatchObject({ ok: true, reused: false });
      expect(psCalls).toHaveLength(1);
    }
  });
});

describe("Part 4.2 — ads: a held Paystack attempt is released only on Paystack's own 4xx", () => {
  const attempt = { reference: "frenz_ad_00000000-0000-4000-8000-000000000009", provider: "paystack", status: "verification_required", checkout_url: null } as unknown as Parameters<typeof resolveUncertainAttempt>[1];
  const released: unknown[] = [];
  beforeEach(() => {
    released.length = 0;
    db.rpc.ad_payment_release = (args) => (released.push(args), { data: { ok: true }, error: null });
  });

  it("'reference not found' (4xx) → released as never created", async () => {
    psVerify = async () => {
      throw new PaystackHttpError("Transaction reference not found", 400);
    };
    expect(await resolveUncertainAttempt(db.client() as never, attempt)).toEqual({ kind: "refused", code: "released", status: 409 });
    expect(released).toEqual([expect.objectContaining({ p_status: "failed" })]);
  });

  it("🔴 a Paystack 5xx, a timeout or a missing key is NOT proof it was never created → still verifying, nothing released", async () => {
    for (const e of [new PaystackHttpError("upstream", 500), timeout(), new PaystackNotConfiguredError()]) {
      psVerify = async () => {
        throw e;
      };
      expect(await resolveUncertainAttempt(db.client() as never, attempt)).toEqual({ kind: "verifying", reference: attempt.reference });
    }
    expect(released).toEqual([]);
  });
});

describe("the four checkout-start servers never answer 502 (teeth)", () => {
  const FILES = ["lib/sub/server.ts", "lib/social/paid-verification.ts", "lib/ai/character-replace/topup-server.ts", "lib/ads-platform/payment-server.ts"];
  const answers502 = (src: string) => /status:\s*502\b/.test(src);

  it.each(FILES)("%s", (file) => {
    expect(answers502(readFileSync(join(process.cwd(), file), "utf8"))).toBe(false);
  });

  it("the guard catches a 502 when one is there", () => {
    expect(answers502(`return { ok: false, refusal: "unknown", status: 502, error: "x" };`)).toBe(true);
    expect(answers502(`return { kind: "refused", code: "provider_refused", status:502 };`)).toBe(true);
    expect(answers502(`return { ok: false, status: 503 };`)).toBe(false);
  });
});
