import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Paystack configuration — set from the ADMIN DASHBOARD, not hardcoded (owner,
 * 2026-08-02: "add where I add my paystack live or test key and set it up in the
 * dashboard without hard coding … currently paystack isn't set").
 *
 * Stored in the `settings` table under key `paystack` (same pattern as
 * monetization). An admin-set value takes precedence; any field left blank falls
 * back to the matching env var, so an existing env-configured deploy keeps working.
 * The secret is read server-side ONLY and is never returned to the client in full
 * (the admin GET masks it); the settings table is service-role only.
 */

export type PaystackMode = "test" | "live";

export interface PaystackConfig {
  /** sk_live_… / sk_test_… — server-only. */
  secretKey: string;
  /** pk_live_… / pk_test_… — safe to expose to the checkout client. */
  publicKey: string;
  /** PLN_… Pro plan code from the Paystack dashboard. */
  planPro: string;
  /** PLN_… Business plan code. */
  planBusiness: string;
  /** Which key set the dashboard is currently using — informational + UI hint. */
  mode: PaystackMode;
}

export const DEFAULT_PAYSTACK: PaystackConfig = {
  secretKey: "",
  publicKey: "",
  planPro: "",
  planBusiness: "",
  mode: "test",
};

function fromEnv(): PaystackConfig {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim() || "";
  return {
    secretKey: secret,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY?.trim() || "",
    planPro: process.env.PAYSTACK_PLAN_PRO?.trim() || "",
    planBusiness: process.env.PAYSTACK_PLAN_BUSINESS?.trim() || "",
    mode: secret.includes("_live_") ? "live" : "test",
  };
}

/** Infer test/live from whichever key is present. */
export function modeFromKeys(secretKey: string, publicKey: string): PaystackMode {
  const s = `${secretKey} ${publicKey}`;
  if (s.includes("_live_")) return "live";
  return "test";
}

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: PaystackConfig } | null = null;
const TTL_MS = 15_000;

/** The effective Paystack config: admin DB value first, env as the fallback. */
export async function getPaystackConfig(): Promise<PaystackConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const env = fromEnv();
  if (!hasSupabase) return env;
  try {
    const db = createAdminClient();
    const { data } = await db.from("settings").select("value").eq("key", "paystack").maybeSingle();
    const stored = (data?.value ?? {}) as Partial<PaystackConfig>;
    // Field-by-field: a non-empty admin value wins; otherwise fall back to env.
    const pick = (a: string | undefined, b: string) => (a && a.trim() ? a.trim() : b);
    const secretKey = pick(stored.secretKey, env.secretKey);
    const publicKey = pick(stored.publicKey, env.publicKey);
    const value: PaystackConfig = {
      secretKey,
      publicKey,
      planPro: pick(stored.planPro, env.planPro),
      planBusiness: pick(stored.planBusiness, env.planBusiness),
      mode: stored.mode === "live" || stored.mode === "test" ? stored.mode : modeFromKeys(secretKey, publicKey),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return env;
  }
}

/** Admin: persist the Paystack config. Only non-blank fields overwrite — so leaving
 *  the secret blank keeps the existing one (the admin UI never re-sends it). */
export async function setPaystackConfig(patch: Partial<PaystackConfig>): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("settings").select("value").eq("key", "paystack").maybeSingle();
  const current = (data?.value ?? {}) as Partial<PaystackConfig>;
  const merged: PaystackConfig = {
    secretKey: patch.secretKey?.trim() || current.secretKey || "",
    publicKey: patch.publicKey?.trim() ?? current.publicKey ?? "",
    planPro: patch.planPro?.trim() ?? current.planPro ?? "",
    planBusiness: patch.planBusiness?.trim() ?? current.planBusiness ?? "",
    mode:
      patch.mode === "live" || patch.mode === "test"
        ? patch.mode
        : (current.mode as PaystackMode) || "test",
  };
  await db.from("settings").upsert({ key: "paystack", value: merged }, { onConflict: "key" });
  cache = null;
}
