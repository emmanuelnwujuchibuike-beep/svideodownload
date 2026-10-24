import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Check with Flutterwave" (2026-10-23): admin-only, read-only, and it says plainly when a plan can't be used
 * (not USD, inactive, unknown). Flutterwave's answer is scripted.
 */

let admin: { id: string } | null;
let configured = true;
let answer: () => Promise<unknown>;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/guard", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/flutterwave/config", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/config")>()), getFlutterwaveConfig: async () => ({}), flutterwaveConfigured: () => configured }));
vi.mock("@/lib/flutterwave/client", async (orig) => ({ ...(await orig<typeof import("@/lib/flutterwave/client")>()), readFlutterwavePlan: () => answer() }));
// Part 6: the SAVED prices members are shown — AI Pro $10.00 / AI Max $20.00, Pro $4.99 / Business $9.99
vi.mock("@/lib/landing/settings", () => ({ getLandingSettings: async () => ({ frenzAiCurrency: "USD", frenzAiPlans: { plans: { ai_pro: { priceCents: 1000, interval: "monthly" }, ai_max: { priceCents: 2000, interval: "monthly" } } } }) }));
vi.mock("@/lib/monetization/pricing", () => ({ getPricing: async () => ({ pro: { name: "Pro", price: "$4.99", period: "/mo" }, business: { name: "Business", price: "$9.99", period: "/mo" } }) }));

const { POST } = await import("./route");
const { FlutterwaveHttpError } = await import("@/lib/flutterwave/client");
const check = async (id: string, target?: string) => (await POST(new Request("https://frenzsave.com/api/admin/ai/plans/verify-flutterwave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target ? { id, for: target } : { id }) }))) as Response;

beforeEach(() => {
  admin = { id: "a" };
  configured = true;
  answer = async () => ({ id: "123", name: "AI Pro USD", amountMinor: 1000, currency: "USD", interval: "monthly", active: true });
});

describe("Part 6 — checked against the price members are SHOWN (the checkout's own rule)", () => {
  it("a USD monthly plan at exactly the saved price is usable", async () => {
    expect(await (await check("123", "ai_pro")).json()).toMatchObject({ ok: true, usable: true, compat: { ok: true } });
    answer = async () => ({ id: "130", name: "Pro", amountMinor: 499, currency: "USD", interval: "monthly", active: true });
    expect(await (await check("130", "pro")).json()).toMatchObject({ usable: true, compat: { ok: true } });
  });
  it("the owner's 2026-10-24 plans read back as NOT usable, each with its precise reason", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["ai_max", { id: "172633", name: "AI Max", amountMinor: 2000, currency: "NGN", interval: "monthly", active: true }, "currency"],
      ["ai_pro", { id: "172632", name: "AI pro", amountMinor: 1000, currency: "NGN", interval: "monthly", active: true }, "currency"],
      ["business", { id: "172631", name: "Business plan", amountMinor: 499, currency: "NGN", interval: "monthly", active: true }, "currency"],
      ["pro", { id: "172630", name: "Pro plan", amountMinor: 199, currency: "USDT", interval: "monthly", active: true }, "currency"],
    ];
    for (const [target, plan, reason] of cases) {
      answer = async () => plan;
      expect(await (await check(String(plan.id), target)).json(), target).toMatchObject({ ok: true, usable: false, compat: { ok: false, reason } });
    }
  });
  it("a USD plan at another amount than the shown price is NOT usable (amount_mismatch, with both amounts)", async () => {
    answer = async () => ({ id: "130", name: "Pro", amountMinor: 199, currency: "USD", interval: "monthly", active: true });
    expect(await (await check("130", "pro")).json()).toMatchObject({ usable: false, compat: { ok: false, reason: "amount_mismatch", detail: expect.stringContaining("USD 1.99 but members are shown USD 4.99") } });
  });
  it("an unknown target is refused", async () => {
    expect((await check("123", "ai_ultra")).status).toBe(400);
  });
});

describe("Check with Flutterwave", () => {
  it("admins only", async () => {
    admin = null;
    expect((await check("123")).status).toBe(403);
  });
  it("a USD, active plan reads back as usable", async () => {
    expect(await (await check("123")).json()).toMatchObject({ ok: true, usable: true, plan: { name: "AI Pro USD", amountMinor: 1000, currency: "USD" } });
  });
  it("a plan in another currency reads back as NOT usable (Flutterwave charges USD here)", async () => {
    answer = async () => ({ id: "124", name: "AI Pro NGN", amountMinor: 1_500_000, currency: "NGN", interval: "monthly", active: true });
    expect(await (await check("124")).json()).toMatchObject({ ok: true, usable: false });
  });
  it("not a number, unknown to Flutterwave, or Flutterwave not configured → a plain sentence, nothing else", async () => {
    expect(await (await check("PLN_abc")).json()).toMatchObject({ ok: false });
    answer = async () => {
      throw new FlutterwaveHttpError("Plan not found", 404);
    };
    expect(((await (await check("999")).json()) as { error: string }).error).toMatch(/does not know this plan id/);
    configured = false;
    expect(((await (await check("123")).json()) as { error: string }).error).toMatch(/not configured/);
  });
});
