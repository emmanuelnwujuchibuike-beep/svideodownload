import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FLUTTERWAVE — configuration and the ACCOUNT CAPABILITY gate (Part 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-23: Flutterwave is the primary rail for every payment, it
 * charges in USD (the currency every Frenz price is in), and Paystack stays
 * the backup in NGN. Secrets live ONLY in environment variables (Vercel for
 * production, `.env.local` locally) — never in the `settings` table, which
 * an admin session can read through RLS (Part 1 audit, risk 15).
 *
 * ── 🔴 A KEY IS NOT A CAPABILITY ────────────────────────────────────────────
 * A Flutterwave secret key proves we can CALL the API. It does not prove the
 * merchant account may COLLECT a currency (a Nigerian business is not USD-
 * enabled by default), nor that a purpose is ready. So a payment may use
 * Flutterwave only when ALL of these hold. Since 2026-10-24 (owner: "Flutterwave should never be off on default")
 * the three switches below DEFAULT TO ON when unset — USD, every purpose, major units — so the key and the webhook
 * hash are all a deploy needs (see resolveFlutterwaveConfig). "none" / "unconfirmed" or a saved dashboard choice
 * switches them off:
 *
 *   FLUTTERWAVE_SECRET_KEY        the API key (FLWSECK_TEST-… / FLWSECK-…)
 *   FLUTTERWAVE_SECRET_HASH       the webhook secret hash set in the dashboard —
 *                                 without it a webhook can't be told from a forgery,
 *                                 so no checkout is opened at all
 *   FLUTTERWAVE_VERIFIED_CURRENCIES  comma list of currencies Flutterwave has
 *                                 CONFIRMED for this account (e.g. "USD"). Empty =
 *                                 nothing may be collected.
 *   FLUTTERWAVE_ENABLED_PURPOSES  comma list of the purposes switched on
 *                                 (wallet_topup, sub_purchase, verification, ad_campaign).
 *                                 Empty = none.
 *   FLUTTERWAVE_AMOUNT_UNIT       "major", set only after a sandbox charge proved that
 *                                 `amount` is in major units (Part 2.1). Unset = closed.
 *
 * Plans (2026-10-23) are Flutterwave PAYMENT PLANS (USD, card only): AI plans (ai_subscription) and the Pro / Business
 * site plans (site_subscription), each used when its purpose is switched on here AND the plan carries a Flutterwave
 * plan id (AI plans: Admin → AI Plans; site plans: Admin → Flutterwave). Paystack stays their backup.
 */

/** The currency Flutterwave is asked to collect in (owner, 2026-10-23). Never the Paystack checkout currency. */
export const FLUTTERWAVE_CHECKOUT_CURRENCY = "USD";

/**
 * The purposes a Flutterwave checkout can serve: one-off charges, and (2026-10-23) the AI plans and the Pro / Business
 * site plans as Flutterwave PAYMENT PLANS (USD, card only).
 */
export const FLUTTERWAVE_PURPOSES = ["wallet_topup", "sub_purchase", "verification", "ad_campaign", "ai_subscription", "site_subscription"] as const;
export type FlutterwavePurpose = (typeof FLUTTERWAVE_PURPOSES)[number];

export type FlutterwaveMode = "test" | "live";

export interface FlutterwaveConfig {
  /** server-only; never logged, never returned to a browser */
  secretKey: string;
  /** server-only; compared with the `verif-hash` header */
  secretHash: string;
  mode: FlutterwaveMode;
  verifiedCurrencies: readonly string[];
  enabledPurposes: readonly FlutterwavePurpose[];
  /**
   * Part 2.1: the operator's confirmation, from a SANDBOX charge, that Flutterwave's `amount` is in
   * MAJOR units (10.50 = $10.50) — the docs' examples suggest it but never state it. Anything but
   * "major" keeps the gate closed: a wrong unit would mis-price every charge by 100×.
   */
  amountUnitConfirmed: boolean;
  /** The Flutterwave PAYMENT PLAN ids (digits) of the Pro / Business site plans — "" = that plan is Paystack only. */
  sitePlanPro: string;
  sitePlanBusiness: string;
  /** 2026-10-24: NAIRA payment plans for members in Nigeria paying by card (renew monthly). "" = the USD plan. */
  sitePlanProNgn: string;
  sitePlanBusinessNgn: string;
  /**
   * Part 3.3: may a RENEWAL be tied to its subscription automatically? Only once a SANDBOX renewal has proved that
   * GET /v3/subscriptions?transaction_id=<the renewal's id> returns the stored subscription (Flutterwave documents that
   * filter for the FIRST charge only). Env-only (FLUTTERWAVE_RENEWAL_TX_LOOKUP=confirmed), never the dashboard: until then
   * every renewal waits in Admin → Flutterwave → Reviews and nothing is extended on an email or a price.
   */
  renewalLookupConfirmed: boolean;
}

/** The ON defaults (owner, 2026-10-24): what an unset env var / unsaved dashboard means. */
// NGN (2026-10-24): one-off checkouts in Nigeria charge naira so bank transfer / USSD show (lib/payments/flutterwave-charge.ts)
export const DEFAULT_VERIFIED_CURRENCIES: readonly string[] = [FLUTTERWAVE_CHECKOUT_CURRENCY, "NGN"];
export const DEFAULT_AMOUNT_UNIT = "major";

const planId = (v: unknown): string => (typeof v === "string" && /^\d{1,12}$/.test(v.trim()) ? v.trim() : "");

const list =(v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * What the admin dashboard saved (0272 `payment_provider_settings`, provider 'flutterwave' — a PRIVATE
 * table: service role only, unlike `settings`). Every field optional; a blank/absent one falls back to env.
 */
export interface StoredFlutterwave {
  secretKey?: string;
  secretHash?: string;
  verifiedCurrencies?: string[];
  enabledPurposes?: string[];
  /** "major" once a sandbox charge proved the unit; "" = not confirmed */
  amountUnit?: string;
  /** Pro / Business site plans: their Flutterwave payment-plan ids */
  sitePlanPro?: string;
  sitePlanBusiness?: string;
  sitePlanProNgn?: string;
  sitePlanBusinessNgn?: string;
}

/**
 * The effective configuration (pure): the admin dashboard's value first, the env var as the fallback —
 * the same precedence Paystack has (lib/paystack/config.ts). Lists: a saved list (even an empty one,
 * which means "none") wins over env.
 */
export function resolveFlutterwaveConfig(env: Record<string, string | undefined> = process.env, stored: StoredFlutterwave | null = null): FlutterwaveConfig {
  const pick = (a: string | undefined, b: string | undefined) => (a && a.trim() ? a.trim() : (b ?? "").trim());
  const secretKey = pick(stored?.secretKey, env.FLUTTERWAVE_SECRET_KEY);
  /*
    🟢 ON BY DEFAULT (owner, 2026-10-24: "Flutterwave should never be off on default, it should be on and working
    immediately after push"). With nothing saved in the dashboard and the env var unset or blank, the capability
    switches take their ON values: USD verified, every purpose enabled, amounts in major units (proved by a sandbox
    charge in Part 2.1). So the secret key + webhook hash — which nothing can default — are all Flutterwave needs.
    To switch it OFF: save the switches in Admin → Flutterwave (a saved list wins, even an empty one), or set the env
    var to "none" (lists) / "unconfirmed" (amount unit).
  */
  const envList = (v: string | undefined, fallback: readonly string[]) => (/^\s*(none|off)\s*$/i.test(v ?? "") ? [] : list(v).length ? list(v) : [...fallback]);
  const currencies = Array.isArray(stored?.verifiedCurrencies) ? stored.verifiedCurrencies : envList(env.FLUTTERWAVE_VERIFIED_CURRENCIES, DEFAULT_VERIFIED_CURRENCIES);
  const purposes = Array.isArray(stored?.enabledPurposes) ? stored.enabledPurposes : envList(env.FLUTTERWAVE_ENABLED_PURPOSES, FLUTTERWAVE_PURPOSES);
  const unit = typeof stored?.amountUnit === "string" && stored.amountUnit !== "" ? stored.amountUnit : (env.FLUTTERWAVE_AMOUNT_UNIT ?? "").trim() || DEFAULT_AMOUNT_UNIT;
  return {
    secretKey,
    secretHash: pick(stored?.secretHash, env.FLUTTERWAVE_SECRET_HASH),
    mode: secretKey.startsWith("FLWSECK_TEST") ? "test" : "live",
    verifiedCurrencies: currencies.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c)),
    enabledPurposes: purposes.map((p) => String(p).trim()).filter((p): p is FlutterwavePurpose => (FLUTTERWAVE_PURPOSES as readonly string[]).includes(p)),
    amountUnitConfirmed: unit.trim().toLowerCase() === "major",
    sitePlanPro: planId(stored?.sitePlanPro) || planId(env.FLUTTERWAVE_PLAN_PRO),
    sitePlanBusiness: planId(stored?.sitePlanBusiness) || planId(env.FLUTTERWAVE_PLAN_BUSINESS),
    sitePlanProNgn: planId(stored?.sitePlanProNgn) || planId(env.FLUTTERWAVE_PLAN_PRO_NGN),
    sitePlanBusinessNgn: planId(stored?.sitePlanBusinessNgn) || planId(env.FLUTTERWAVE_PLAN_BUSINESS_NGN),
    renewalLookupConfirmed: (env.FLUTTERWAVE_RENEWAL_TX_LOOKUP ?? "").trim().toLowerCase() === "confirmed",
  };
}

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
let storedCache: { at: number; value: StoredFlutterwave | null } | null = null;
const TTL_MS = 15_000;

/** The saved row, cached 15 s (like Paystack). A missing table (before 0272) or a read error = nothing saved: env only. */
export async function readStoredFlutterwave(): Promise<StoredFlutterwave | null> {
  if (!hasSupabase) return null;
  if (storedCache && Date.now() - storedCache.at < TTL_MS) return storedCache.value;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient().from("payment_provider_settings").select("value").eq("provider", "flutterwave").maybeSingle();
    const value = error ? null : (((data as { value?: StoredFlutterwave } | null)?.value ?? null) as StoredFlutterwave | null);
    storedCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

/** The effective Flutterwave configuration: the admin dashboard's saved values first, env as the fallback. */
export async function getFlutterwaveConfig(): Promise<FlutterwaveConfig> {
  return resolveFlutterwaveConfig(process.env, await readStoredFlutterwave());
}

/**
 * Admin save (the route checks admin + fresh password first). A blank secret or hash KEEPS the saved one
 * (the form never re-sends a secret); the switches are replaced as given. Never logged.
 */
export async function setFlutterwaveConfig(patch: StoredFlutterwave & { clearSecretKey?: boolean; clearSecretHash?: boolean }, adminId: string | null): Promise<void> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data } = await db.from("payment_provider_settings").select("value").eq("provider", "flutterwave").maybeSingle();
  const current = ((data as { value?: StoredFlutterwave } | null)?.value ?? {}) as StoredFlutterwave;
  const next: StoredFlutterwave = {
    secretKey: patch.clearSecretKey ? "" : patch.secretKey?.trim() || current.secretKey || "",
    secretHash: patch.clearSecretHash ? "" : patch.secretHash?.trim() || current.secretHash || "",
    verifiedCurrencies: patch.verifiedCurrencies ?? current.verifiedCurrencies,
    enabledPurposes: patch.enabledPurposes ?? current.enabledPurposes,
    amountUnit: patch.amountUnit ?? current.amountUnit ?? "",
    sitePlanPro: patch.sitePlanPro ?? current.sitePlanPro ?? "",
    sitePlanBusiness: patch.sitePlanBusiness ?? current.sitePlanBusiness ?? "",
    sitePlanProNgn: patch.sitePlanProNgn ?? current.sitePlanProNgn ?? "",
    sitePlanBusinessNgn: patch.sitePlanBusinessNgn ?? current.sitePlanBusinessNgn ?? "",
  };
  const { error } = await db.from("payment_provider_settings").upsert({ provider: "flutterwave", value: next, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "provider" });
  if (error) throw new Error("payment_provider_settings write failed");
  storedCache = null;
}

/** The API can be called (verify, reconcile) — says nothing about what may be COLLECTED. */
export function flutterwaveConfigured(cfg: FlutterwaveConfig): boolean {
  return !!cfg.secretKey;
}

export type FlutterwaveGate = { ok: true } | { ok: false; reason: "not_configured" | "webhook_secret_missing" | "amount_unit_unconfirmed" | "currency_not_verified" | "purpose_disabled" | "subscriptions_unsupported" };

/**
 * May a NEW checkout for this purpose be opened on Flutterwave, in this currency?
 * The one gate every checkout asks before it writes an attempt. Pure over the config.
 */
export function flutterwaveCheckoutGate(purpose: string, currency: string, cfg: FlutterwaveConfig): FlutterwaveGate {
  const rail = flutterwaveCollectionGate(currency, cfg);
  if (!rail.ok && rail.reason !== "currency_not_verified") return rail;
  if (!(cfg.enabledPurposes as readonly string[]).includes(purpose)) return { ok: false, reason: "purpose_disabled" };
  return rail;
}

/**
 * The rail half of the gate: key, webhook hash, the confirmed amount unit and the currency — without the purpose list.
 * Frenz Coin Part 4: a coin deposit's purpose switch is the audited `frenzCoin` setting, not this list (lib/coin/deposits.ts).
 */
export function flutterwaveCollectionGate(currency: string, cfg: FlutterwaveConfig): FlutterwaveGate {
  if (!cfg.secretKey) return { ok: false, reason: "not_configured" };
  if (!cfg.secretHash) return { ok: false, reason: "webhook_secret_missing" };
  if (!cfg.amountUnitConfirmed) return { ok: false, reason: "amount_unit_unconfirmed" };
  if (!cfg.verifiedCurrencies.includes(currency.toUpperCase())) return { ok: false, reason: "currency_not_verified" };
  return { ok: true };
}

/** Shorthand for the router's `usable`: Flutterwave in its own checkout currency. */
export function flutterwaveUsableFor(purpose: string, cfg: FlutterwaveConfig): boolean {
  return flutterwaveCheckoutGate(purpose, FLUTTERWAVE_CHECKOUT_CURRENCY, cfg).ok;
}
