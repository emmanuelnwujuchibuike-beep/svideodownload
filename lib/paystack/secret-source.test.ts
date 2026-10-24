import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Part 2.1 — where the Paystack SECRET is read from. The stored copy in `settings` is readable by an
 * admin's own session (RLS "settings admin all"), so the operator can move it to server-only env with
 * PAYSTACK_SECRET_SOURCE=env. Until they do, nothing changes. Fixture keys only (no real secret).
 */

let db: FakeDb;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));

const STORED = "sk_test_STORED_fixture_000000000000";
const FROM_ENV = "sk_live_ENV_fixture_0000000000000000";
const saved = () => (db.tables.settings!.find((r) => r.key === "paystack")!.value as Record<string, string>).secretKey;

beforeEach(() => {
  vi.resetModules();
  db = fakeDb({ settings: [{ key: "paystack", value: { secretKey: STORED, publicKey: "pk_test_x", mode: "test" } }] });
  db.unique.settings = [["key"]];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-fixture");
  vi.stubEnv("PAYSTACK_SECRET_KEY", FROM_ENV);
  vi.stubEnv("PAYSTACK_SECRET_SOURCE", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the Paystack secret's source", () => {
  it("default (no opt-in): the stored value wins, exactly as before — existing payments unchanged", async () => {
    const { getPaystackConfig } = await import("./config");
    const c = await getPaystackConfig();
    expect(c.secretKey).toBe(STORED);
    expect(c.mode).toBe("test");
  });

  it("opted in (PAYSTACK_SECRET_SOURCE=env + PAYSTACK_SECRET_KEY): the env secret is used, and its own mode", async () => {
    vi.stubEnv("PAYSTACK_SECRET_SOURCE", "env");
    const { getPaystackConfig } = await import("./config");
    const c = await getPaystackConfig();
    expect(c.secretKey).toBe(FROM_ENV);
    expect(c.mode).toBe("live");
    expect(c.publicKey).toBe("pk_test_x");
  });

  it("opted in WITHOUT an env secret: no switch happens (never a payment system with no key)", async () => {
    vi.stubEnv("PAYSTACK_SECRET_SOURCE", "env");
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const { getPaystackConfig, paystackSecretFromEnv } = await import("./config");
    expect(paystackSecretFromEnv()).toBe(false);
    expect((await getPaystackConfig()).secretKey).toBe(STORED);
  });

  it("opted in: an admin save never writes a secret into the admin-readable table again", async () => {
    vi.stubEnv("PAYSTACK_SECRET_SOURCE", "env");
    const { setPaystackConfig } = await import("./config");
    await setPaystackConfig({ secretKey: "sk_live_typed_in_the_form_000000", planPro: "PLN_x" });
    expect(saved()).toBe(STORED); // untouched — neither replaced by the typed one nor erased
  });

  it("not opted in: an admin save still stores the secret, as before", async () => {
    const { setPaystackConfig } = await import("./config");
    await setPaystackConfig({ secretKey: "sk_test_new_fixture_000000000000" });
    expect(saved()).toBe("sk_test_new_fixture_000000000000");
  });

  it("the admin route returns only a mask and the source — never the secret", () => {
    const route = readFileSync(join(process.cwd(), "app/api/admin/paystack/route.ts"), "utf8");
    expect(route).toContain("secretMasked: mask(c.secretKey),");
    expect(route).toContain('secretSource: paystackSecretFromEnv() ? "env" : "settings",');
    expect(route).not.toMatch(/secretKey: c\.secretKey/);
  });
});
