import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Flutterwave configured from the admin dashboard (owner, 2026-10-23), stored in the PRIVATE
 * payment_provider_settings table (0272). The real route and config module over an in-memory database;
 * admin and re-auth scripted. Fixture keys only.
 */

let db: FakeDb;
let admin: { id: string } | null;
let reauthOk: boolean;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/admin/require-admin", () => ({ getAdminUser: async () => admin }));
vi.mock("@/lib/admin/reauth", () => ({ requireSensitiveAdmin: async () => (reauthOk ? { ok: true } : { ok: false, response: new Response(JSON.stringify({ error: "reauth" }), { status: 401 }) }) }));

const KEY = "FLWSECK_TEST-abcdef0123456789abcdef-X";
const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
  for (const k of ["FLUTTERWAVE_SECRET_KEY", "FLUTTERWAVE_SECRET_HASH", "FLUTTERWAVE_VERIFIED_CURRENCIES", "FLUTTERWAVE_ENABLED_PURPOSES", "FLUTTERWAVE_AMOUNT_UNIT"]) vi.stubEnv(k, "");
  db = fakeDb({ payment_provider_settings: [] });
  db.unique.payment_provider_settings = [["provider"]];
  admin = { id: "11111111-1111-4111-8111-111111111111" };
  reauthOk = true;
});

const route = () => import("./route");
const post = async (body: unknown) => (await route()).POST(new Request("https://frenzsave.com/api/admin/flutterwave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = async () => (await (await route()).GET()).json() as Promise<Record<string, unknown>>;
const stored = () => db.tables.payment_provider_settings!.find((r) => r.provider === "flutterwave")?.value as Record<string, unknown> | undefined;

describe("admin: Flutterwave settings", () => {
  it("non-admins get nothing; saving needs the fresh-password re-auth", async () => {
    admin = null;
    expect((await (await route()).GET()).status).toBe(403);
    admin = { id: "a" };
    reauthOk = false;
    expect((await post({ secretKey: KEY })).status).toBe(401);
    expect(stored()).toBeUndefined();
  });

  it("saves to the private table, and GET returns only masks and sources — never a secret", async () => {
    expect((await post({ secretKey: KEY, secretHash: HASH, verifiedCurrencies: ["USD"], enabledPurposes: ["wallet_topup"], amountUnit: "major" })).status).toBe(200);
    expect(stored()).toMatchObject({ secretKey: KEY, secretHash: HASH, verifiedCurrencies: ["USD"], enabledPurposes: ["wallet_topup"], amountUnit: "major" });
    const d = await get();
    const text = JSON.stringify(d);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(HASH);
    expect(d).toMatchObject({ secretSet: true, secretSource: "dashboard", hashSet: true, hashSource: "dashboard", mode: "test", webhookUrl: expect.stringMatching(/\/api\/flutterwave\/webhook$/) });
    expect((d.gates as Record<string, { ok: boolean }>).wallet_topup?.ok).toBe(true);
    expect((d.gates as Record<string, { ok: boolean; reason?: string }>).ad_campaign).toEqual({ ok: false, reason: "purpose_disabled" });
  });

  it("a blank secret keeps the saved one; the switches are replaced as sent; explicit remove clears", async () => {
    await post({ secretKey: KEY, secretHash: HASH, enabledPurposes: ["wallet_topup", "ad_campaign"] });
    await post({ secretKey: "", enabledPurposes: [] });
    expect(stored()).toMatchObject({ secretKey: KEY, secretHash: HASH, enabledPurposes: [] });
    await post({ clearSecretKey: true });
    expect(stored()).toMatchObject({ secretKey: "", secretHash: HASH });
  });

  it("refuses what isn't a Flutterwave key, a weak hash, or an unknown purpose", async () => {
    expect((await post({ secretKey: "sk_live_paystack_key_123456" })).status).toBe(400);
    expect((await post({ secretHash: "short" })).status).toBe(400);
    // AI plans and Pro/Business site plans are Flutterwave purposes since 2026-10-23; payouts are not
    expect((await post({ enabledPurposes: ["payouts"] })).status).toBe(400);
    // a site plan id is Flutterwave's number, never a Paystack plan code
    expect((await post({ sitePlanPro: "PLN_abc" })).status).toBe(400);
    expect((await post({ amountUnit: "minor" })).status).toBe(400);
    expect(stored()).toBeUndefined();
  });

  it("nothing saved: env still works as the fallback (Vercel), and the gate stays closed by default", async () => {
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", KEY);
    const d = await get();
    expect(d).toMatchObject({ secretSource: "env", hashSource: "none" });
    expect((d.gates as Record<string, { ok: boolean; reason?: string }>).wallet_topup).toEqual({ ok: false, reason: "webhook_secret_missing" });
  });
});

describe("the effective configuration: the dashboard first, env as the fallback", () => {
  it("dashboard values win; a saved EMPTY list means none even if env lists some", async () => {
    const { resolveFlutterwaveConfig } = await import("@/lib/flutterwave/config");
    const env = { FLUTTERWAVE_SECRET_KEY: "FLWSECK-env-0000000000000000", FLUTTERWAVE_ENABLED_PURPOSES: "wallet_topup", FLUTTERWAVE_VERIFIED_CURRENCIES: "USD", FLUTTERWAVE_AMOUNT_UNIT: "major" };
    const c = resolveFlutterwaveConfig(env, { secretKey: KEY, enabledPurposes: [], verifiedCurrencies: [] });
    expect(c.secretKey).toBe(KEY);
    expect(c.enabledPurposes).toEqual([]);
    expect(c.verifiedCurrencies).toEqual([]);
    expect(c.amountUnitConfirmed).toBe(true); // amount unit not saved → env
    expect(resolveFlutterwaveConfig(env, null).enabledPurposes).toEqual(["wallet_topup"]);
  });
  it("the webhook verifies against the dashboard hash", async () => {
    const { verifyFlutterwaveWebhook } = await import("@/lib/flutterwave/client");
    db.tables.payment_provider_settings!.push({ provider: "flutterwave", value: { secretHash: HASH } });
    expect(await verifyFlutterwaveWebhook(HASH)).toBe(true);
    expect(await verifyFlutterwaveWebhook("wrong-hash-value-0000000000")).toBe(false);
  });
});

describe("the storage is private", () => {
  it("0272: RLS on, no policy, every client grant revoked", () => {
    const m = readFileSync(join(process.cwd(), "supabase/migrations/0272_payment_provider_settings.sql"), "utf8");
    expect(m).toContain("alter table public.payment_provider_settings enable row level security;");
    expect(m).toContain("revoke all on public.payment_provider_settings from public, anon, authenticated;");
    expect(m).not.toMatch(/create policy/i);
  });
});
