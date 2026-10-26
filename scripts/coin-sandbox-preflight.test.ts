import { describe, expect, it } from "vitest";

import { preflight } from "./coin-sandbox-preflight.mjs";

/**
 * Frenz Coin Part 8 — the sandbox preflight must REFUSE anything that is not provably isolated: the production project,
 * an unnamed project, live provider keys, a missing PIN pepper. And it must never echo a secret.
 */
const SANDBOX = {
  NEXT_PUBLIC_SUPABASE_URL: "https://sandboxref123.supabase.co",
  FRENZ_SANDBOX_SUPABASE_REF: "sandboxref123",
  FRENZ_PRODUCTION_SUPABASE_REF: "prodref456",
  FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-abc",
  FLUTTERWAVE_PUBLIC_KEY: "FLWPUBK_TEST-abc",
  FLUTTERWAVE_SECRET_HASH: "hash",
  PAYSTACK_SECRET_KEY: "sk_test_abc",
  FRENZ_COIN_PIN_PEPPER: "x".repeat(40),
};
const refused = (env: Record<string, string>) => (preflight(env) as { ok: boolean; label: string }[]).filter((c) => !c.ok).map((c) => c.label);

describe("coin sandbox preflight", () => {
  it("a fully isolated sandbox passes", () => {
    expect(refused(SANDBOX)).toEqual([]);
  });
  it("the production project is refused, even when named as the sandbox", () => {
    expect(refused({ ...SANDBOX, NEXT_PUBLIC_SUPABASE_URL: "https://prodref456.supabase.co" }).join(" ")).toMatch(/NOT production/);
    expect(refused({ ...SANDBOX, FRENZ_SANDBOX_SUPABASE_REF: "prodref456", NEXT_PUBLIC_SUPABASE_URL: "https://prodref456.supabase.co" }).length).toBeGreaterThan(0);
  });
  it("an unnamed project is refused (never guess which project is connected)", () => {
    const { FRENZ_SANDBOX_SUPABASE_REF: _s, ...noName } = SANDBOX;
    expect(refused(noName).join(" ")).toMatch(/disposable/);
  });
  it("live Flutterwave or Paystack keys are refused", () => {
    expect(refused({ ...SANDBOX, FLUTTERWAVE_SECRET_KEY: "FLWSECK-live" }).join(" ")).toMatch(/FLUTTERWAVE_SECRET_KEY/);
    expect(refused({ ...SANDBOX, FLUTTERWAVE_PUBLIC_KEY: "FLWPUBK-live" }).join(" ")).toMatch(/FLUTTERWAVE_PUBLIC_KEY/);
    expect(refused({ ...SANDBOX, PAYSTACK_SECRET_KEY: "sk_live_abc" }).join(" ")).toMatch(/PAYSTACK_SECRET_KEY/);
  });
  it("a missing or short PIN pepper is refused", () => {
    expect(refused({ ...SANDBOX, FRENZ_COIN_PIN_PEPPER: "short" }).join(" ")).toMatch(/PEPPER/);
  });
  it("never echoes a secret value", () => {
    const text = JSON.stringify(preflight({ ...SANDBOX, FLUTTERWAVE_SECRET_KEY: "FLWSECK-SECRETVALUE" }));
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain("sandboxref123");
  });
});
