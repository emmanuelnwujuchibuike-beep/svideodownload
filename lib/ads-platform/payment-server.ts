import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import type { PaymentMarket, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { getLandingSettings } from "@/lib/landing/settings";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY } from "@/lib/flutterwave/config";
import { chargeMatches, type VerifiedCharge } from "@/lib/payments/charge";
import { usableRails } from "@/lib/payments/rails";
import { flutterwaveChargeFor } from "@/lib/payments/flutterwave-charge";
import { newFlutterwaveReference } from "@/lib/payments/references";
import { routePayment } from "@/lib/payments/router";
import { initializeAdCheckout, paystackFailureIsDefinite, paystackRefusedForSure, verifyTransaction } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";

import { notifyAdvertiser } from "./ad-notify";

import { advanceCampaignProcessing } from "./media-processing";
import { activateCampaign, checkDestination } from "./server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ADS ON THE EXISTING RAILS (Part 3) — no second payment system
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   quote (0197 ad_payment_quotes, written at submission)
 *     → createAdCampaignPayment: lib/payments/router.ts picks the rail for
 *       purpose `ad_campaign` → ad_payment_begin (one transaction: quote,
 *       campaigns, the attempt row in ai_topup_attempts) → the provider's
 *       hosted checkout
 *     → the provider's SIGNED webhook (or a verify-on-return that asks the
 *       provider itself) → ad_payment_settle (amount, currency, provider,
 *       purpose, window - once) → activateCampaign per campaign (idempotent)
 *
 * The browser sends a campaign id and a quote id. Never a price, a currency,
 * a provider (beyond a preference the router may honour), a duration or a
 * status - and its return from checkout proves nothing.
 *
 * ── The fallback rule ───────────────────────────────────────────────────────
 * A provider is followed by the next ONLY when it REFUSED (Paystack's own
 * message: nothing was created). A timeout, a network drop or a 5xx is
 * UNKNOWN: the attempt becomes verification_required and the application
 * stays in payment_processing. It is resolved, never replaced, by verifying
 * our own reference with Paystack.
 *
 * ── Bachs was removed (owner, 2026-10-17) ───────────────────────────────────
 * Paystack is the only rail. Rows a former provider wrote (`provider =
 * 'bachs'`) stay exactly as they are: never redirected to, never re-asked,
 * never released or settled here — a person reconciles them. See
 * docs/PAYMENTS.md "Bachs removed".
 */

type Db = SupabaseClient;
type Rpc = { ok: boolean; reason?: string; [k: string]: unknown };

export const AD_PAYSTACK_PREFIX = "frenz_ad_";
const PROVIDER_CHECK_MIN_AGE_MS = 5_000;

/** A row written by a removed provider (Bachs): held as it is, for manual reconciliation. Paystack and Flutterwave (Part 2) are live rails. */
const legacyProvider = (a: { provider: string }) => a.provider !== "paystack" && a.provider !== "flutterwave";
const liveProvider = (a: { provider: string }): TopupProviderId => (a.provider === "flutterwave" ? "flutterwave" : "paystack");

const log = (event: string, fields: Record<string, unknown>) => console.info(`[ads-pay] ${event}`, fields);

/* ─────────────────────────────────── quotes ─────────────────────────────────── */

/** Record the price just locked at submission as the application's ONE open quote. */
export async function createQuote(db: Db, input: { applicationId: string; userId: string; currency: string; total: number; lines: unknown }): Promise<{ id: string; expiresAt: string }> {
  const { data: s } = await db.from("ad_platform_settings").select("quote_ttl_minutes").limit(1);
  const ttl = Number(s?.[0]?.quote_ttl_minutes ?? 30);
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  await db.from("ad_payment_quotes").update({ status: "superseded" }).eq("application_id", input.applicationId).eq("status", "open");
  const { data, error } = await db
    .from("ad_payment_quotes")
    .insert({ application_id: input.applicationId, user_id: input.userId, currency: input.currency, total_minor: input.total, lines: input.lines, expires_at: expiresAt })
    .select("id, expires_at")
    .single();
  if (error || !data) throw new Error(`ad_payment_quotes: ${error?.message}`);
  log("payment_quote_created", { applicationId: input.applicationId, quoteId: data.id, total: input.total, currency: input.currency });
  return { id: data.id as string, expiresAt: data.expires_at as string };
}

/* ─────────────────────────────────── begin ─────────────────────────────────── */

interface Attempt {
  reference: string;
  user_id: string;
  /** "paystack" — or a removed provider's name on a historical row ("bachs") */
  provider: string;
  status: string;
  item_id: string;
  amount_cents: number;
  currency: string;
  provider_currency: string | null;
  provider_amount: number | null;
  fx_minor_per_usd: number | null;
  external_id: string | null;
  checkout_url: string | null;
  provider_request: Record<string, unknown> | null;
  created_at: string;
  verified_at: string | null;
  status_reason: string | null;
  quote_id: string | null;
}

const ATTEMPT_COLUMNS = "reference, user_id, provider, status, item_id, amount_cents, currency, provider_currency, provider_amount, fx_minor_per_usd, external_id, checkout_url, provider_request, created_at, verified_at, status_reason, quote_id";

export type PaymentStart =
  | { kind: "redirect"; url: string; reference: string; provider: TopupProviderId }
  | { kind: "verifying"; reference: string }
  | { kind: "refused"; code: string; status: number };

async function openAttempt(db: Db, applicationId: string): Promise<Attempt | null> {
  const { data } = await db.from("ai_topup_attempts").select(ATTEMPT_COLUMNS).eq("purpose", "ad_campaign").eq("item_id", applicationId).in("status", ["pending", "verification_required"]).maybeSingle();
  return (data as Attempt | null) ?? null;
}

const returnUrl = (reference: string) => `${SITE_URL}/advertise/payment?reference=${encodeURIComponent(reference)}`;

/**
 * POST /api/ads/payment/create. Re-entrant: a second tap while a checkout is
 * open returns THAT checkout - never a second one (also a unique index).
 */
export async function createAdCampaignPayment(
  db: Db,
  input: { userId: string; email: string; campaignId: string; quoteId: string; market: PaymentMarket; preferredProvider?: unknown; extension?: boolean },
): Promise<PaymentStart> {
  const { data: settings } = await db.from("ad_platform_settings").select("payments_enabled").limit(1);
  if (settings?.[0]?.payments_enabled !== true) return { kind: "refused", code: "payments_disabled", status: 503 };

  const { data: head } = await db.from("ad_campaigns").select("id, application_id, advertisers!inner(user_id)").eq("id", input.campaignId).maybeSingle();
  const owner = (head as { advertisers?: { user_id?: string } } | null)?.advertisers?.user_id;
  if (!head || owner !== input.userId) return { kind: "refused", code: "not_found", status: 404 };
  // Part 6: an extension is paid against the campaign ITSELF (its quote is keyed to it),
  // through the same attempt ledger, providers, webhooks and settle
  const applicationId = input.extension ? (head.id as string) : ((head.application_id as string | null) ?? (head.id as string));

  // an open checkout? hand it back (double tap, two tabs, a retry)
  const open = await openAttempt(db, applicationId);
  if (open) {
    // a removed provider's open checkout is never handed back (it would send the member there): held
    if (legacyProvider(open)) return { kind: "verifying", reference: open.reference };
    if (open.status === "pending" && open.checkout_url) return { kind: "redirect", url: open.checkout_url, reference: open.reference, provider: liveProvider(open) };
    const resolved = await resolveUncertainAttempt(db, open);
    if (resolved.kind !== "refused" || resolved.code !== "released") return resolved;
  }

  // the creative and the link are re-checked right before money moves
  const { data: creatives } = await db.from("ad_creatives").select("validation_status, url_validation_status, destination_url").eq("campaign_id", applicationId).eq("status", "active");
  const cr = creatives?.[0];
  // a link still pending review may be paid for — since 0210 it goes live at once (only a BLOCKED link holds)
  if (!cr || cr.validation_status !== "valid" || !["valid", "pending"].includes(cr.url_validation_status as string) || !cr.destination_url) return { kind: "refused", code: "creative_not_valid", status: 409 };
  const dest = await checkDestination(db, cr.destination_url as string);
  if (dest.status === "blocked") return { kind: "refused", code: "destination_blocked", status: 409 };

  const { data: quote } = await db.from("ad_payment_quotes").select("id, total_minor, currency, status, expires_at").eq("id", input.quoteId).eq("application_id", applicationId).maybeSingle();
  if (!quote || quote.status !== "open") return { kind: "refused", code: "quote_invalid", status: 409 };
  if (Date.parse(quote.expires_at as string) <= Date.now()) return { kind: "refused", code: "quote_expired", status: 409 };
  const totalUsd = Number(quote.total_minor);

  const landing = await getLandingSettings();
  // Part 2: Flutterwave (USD, the quote as it is) when its account capability is confirmed; Paystack (NGN) otherwise or after a refusal
  const usable = await usableRails("ad_campaign");
  const candidates = routePayment({
    purpose: "ad_campaign",
    market: input.market,
    routing: landing.frenzAiPlans.wallet.routing,
    usable,
    preferred: landing.frenzAiPlans.wallet.memberChoice ? input.preferredProvider : undefined,
  });
  if (!candidates.length) return { kind: "refused", code: "payments_unavailable", status: 503 };

  return firstCheckout(candidates, (provider, i) => {
    log("payment_provider_selected", { applicationId, provider, attempt: i + 1, market: input.market });
    return provider === "flutterwave" ? beginFlutterwave(db, input, applicationId, input.quoteId, totalUsd) : beginPaystack(db, input, applicationId, input.quoteId, totalUsd, landing);
  });
}

/**
 * The fallback rule, on its own so it can be tested: try the router's
 * candidates in order and move on ONLY after a refusal ("provider_refused":
 * nothing was created). A checkout, an uncertain outcome ("verifying") or any
 * other refusal ends the loop - the next rail is never tried after money may
 * have been asked for.
 */
export async function firstCheckout(candidates: readonly TopupProviderId[], tryProvider: (p: TopupProviderId, index: number) => Promise<PaymentStart>): Promise<PaymentStart> {
  for (const [i, provider] of candidates.entries()) {
    const r = await tryProvider(provider, i);
    if (r.kind !== "refused" || r.code !== "provider_refused") return r;
    if (i + 1 < candidates.length) console.warn("[ads-pay] fallback_triggered", { from: provider, to: candidates[i + 1] });
  }
  // 503, never 502: Cloudflare replaces an origin 502 with its own HTML page. `code`, not the status, decides the fallback
  return { kind: "refused", code: "payment_not_started", status: 503 };
}

async function begin(db: Db, input: { userId: string }, applicationId: string, quoteId: string, reference: string, provider: TopupProviderId, totalUsd: number, providerCurrency: string, providerAmount: number, fx: number | null, metadata: Record<string, unknown>): Promise<PaymentStart | null> {
  const { data, error } = await db.rpc("ad_payment_begin", {
    p_user: input.userId, p_application: applicationId, p_quote: quoteId, p_reference: reference, p_provider: provider,
    p_amount_usd: totalUsd, p_provider_currency: providerCurrency, p_provider_amount: providerAmount, p_fx: fx, p_metadata: metadata,
  });
  if (error) {
    // the unique index lost a race to a parallel tap - hand back that one
    if (error.code === "23505") {
      const open = await openAttempt(db, applicationId);
      if (open?.checkout_url && !legacyProvider(open)) return { kind: "redirect", url: open.checkout_url, reference: open.reference, provider: liveProvider(open) };
      return { kind: "verifying", reference: open?.reference ?? reference };
    }
    throw new Error(`ad_payment_begin: ${error.message}`);
  }
  const r = data as Rpc;
  if (!r.ok) {
    if (r.reason === "payment_open") return { kind: "verifying", reference: String(r.reference) };
    return { kind: "refused", code: r.reason ?? "not_payable", status: r.reason === "payments_disabled" ? 503 : 409 };
  }
  return null;
}

async function release(db: Db, reference: string, status: "failed" | "abandoned" | "expired" | "verification_required" | "mismatch", reason: string): Promise<void> {
  const { error } = await db.rpc("ad_payment_release", { p_reference: reference, p_status: status, p_reason: reason });
  if (error) console.error("[ads-pay] release failed", { reference, status, error: error.message });
}

async function beginPaystack(db: Db, input: { userId: string; email: string }, applicationId: string, quoteId: string, totalUsd: number, landing: Awaited<ReturnType<typeof getLandingSettings>>): Promise<PaymentStart> {
  // USD price → the checkout currency at the EXISTING FX service's rate (live, cached, plus the operator's markup)
  const cr = landing.frenzAiCharacterReplace;
  const rate = await resolveCheckoutRate(cr, "USD");
  if (rate && "error" in rate) return { kind: "refused", code: "provider_refused", status: 503 };
  const q = quoteCheckout({ walletAmountCents: totalUsd, walletCurrency: "USD", checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in q) return { kind: "refused", code: "provider_refused", status: 503 };

  const reference = `${AD_PAYSTACK_PREFIX}${randomUUID()}`;
  const stop = await begin(db, input, applicationId, quoteId, reference, "paystack", totalUsd, q.currency, q.amount, q.minorPerUsd, {
    quoted_usd_cents: totalUsd,
    fx_source: rate?.source ?? null,
    fx_market_per_usd: rate?.marketPerUsd ?? null,
    fx_markup_percent: rate?.markupPercent ?? null,
  });
  if (stop) return stop;
  try {
    const url = await initializeAdCheckout({
      email: input.email,
      userId: input.userId,
      amount: q.amount,
      currency: q.currency,
      reference,
      callbackUrl: returnUrl(reference),
      metadata: { application_id: applicationId, quote_id: quoteId, quoted_usd_cents: totalUsd, fx_minor_per_usd: q.minorPerUsd },
    });
    await db.from("ai_topup_attempts").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    log("payment_session_created", { provider: "paystack", reference, applicationId, currency: q.currency, amount: q.amount });
    return { kind: "redirect", url, reference, provider: "paystack" };
  } catch (e) {
    if (paystackFailureIsDefinite(e)) {
      await release(db, reference, "failed", "checkout refused by provider");
      console.warn("[ads-pay] provider refused checkout", { provider: "paystack", reference, error: String(e).slice(0, 200) });
      return { kind: "refused", code: "provider_refused", status: 503 };
    }
    await release(db, reference, "verification_required", "checkout outcome unknown");
    console.warn("[ads-pay] checkout outcome unknown — held for verification", { provider: "paystack", reference, error: String(e).slice(0, 200) });
    return { kind: "verifying", reference };
  }
}

/**
 * The Flutterwave rail (Part 2): USD — the quote's own currency — at the quoted amount, no
 * conversion. Same attempt ledger (ad_payment_begin), same settle (ad_payment_settle checks the
 * amount and currency against the row it wrote), same fallback rule. A row the database refuses
 * (a CHECK from before migration 0271) is a refusal before anything was created: Paystack may follow.
 */
async function beginFlutterwave(db: Db, input: { userId: string; email: string; market?: PaymentMarket }, applicationId: string, quoteId: string, totalUsd: number): Promise<PaymentStart> {
  // 2026-10-24: naira in Nigeria (bank transfer, USSD…), USD elsewhere — ad_payment_settle checks the row's own currency
  const fw = await flutterwaveChargeFor(totalUsd, input.market, "ad_campaign");
  const reference = newFlutterwaveReference("ad_campaign");
  let stop: PaymentStart | null;
  try {
    stop = await begin(db, input, applicationId, quoteId, reference, "flutterwave", totalUsd, fw.currency, fw.amountMinor, fw.fxMinorPerUsd, { quoted_usd_cents: totalUsd });
  } catch (e) {
    console.warn("[ads-pay] flutterwave attempt not recorded", { reference, error: String(e).slice(0, 200) });
    return { kind: "refused", code: "provider_refused", status: 503 };
  }
  if (stop) return stop;
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: fw.amountMinor, currency: fw.currency, email: input.email, redirectUrl: returnUrl(reference), title: "Frenz ad campaign", meta: { application_id: applicationId, quote_id: quoteId } });
    await db.from("ai_topup_attempts").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    log("payment_session_created", { provider: "flutterwave", reference, applicationId, currency: FLUTTERWAVE_CHECKOUT_CURRENCY, amount: totalUsd });
    return { kind: "redirect", url, reference, provider: "flutterwave" };
  } catch (e) {
    if (flutterwaveFailureIsDefinite(e)) {
      await release(db, reference, "failed", "checkout refused by provider");
      console.warn("[ads-pay] provider refused checkout", { provider: "flutterwave", reference, error: e instanceof Error ? e.name : "unknown" });
      return { kind: "refused", code: "provider_refused", status: 503 };
    }
    await release(db, reference, "verification_required", "checkout outcome unknown");
    console.warn("[ads-pay] checkout outcome unknown — held for verification", { provider: "flutterwave", reference, error: e instanceof Error ? e.name : "unknown" });
    return { kind: "verifying", reference };
  }
}

/** Ask Flutterwave about one of our ad references and act on the answer (verify-on-return, uncertain attempts, reconcile). */
async function askFlutterwave(db: Db, a: Attempt, given?: VerifiedCharge): Promise<"settled" | "released" | "held" | "pending"> {
  const charge = given ?? (await verifyFlutterwaveByReference(a.reference));
  if (charge.status === "success") {
    if (charge.reference !== a.reference) return "pending";
    /*
      🔴 Part 2.1: EXACTLY the amount and currency on the attempt row (lib/payments/charge.ts). ad_payment_settle
      allows "at least" (one unit of rounding, kept as it is for Paystack), so a Flutterwave over- or underpayment
      is stopped here and held as a mismatch for review — no campaign goes live on it.
    */
    const match = chargeMatches(charge, { provider: "flutterwave", reference: a.reference, amountMinor: Number(a.provider_amount ?? a.amount_cents), currency: a.provider_currency ?? a.currency });
    if (!match.ok) {
      await release(db, a.reference, "mismatch", `flutterwave ${match.mismatch}: paid ${charge.amountMinor ?? "?"} ${charge.currency ?? "?"}`);
      console.error("[ads-pay] payment_mismatch", { reference: a.reference, provider: "flutterwave", mismatch: match.mismatch });
      // money moved: HELD for review — never "released", which would let a new checkout open
      return "held";
    }
    // ad_payment_settle checks provider, amount and currency against the attempt row again — never this charge's word alone
    await settleVerified(db, { reference: a.reference, provider: "flutterwave", paidAmount: charge.amountMinor, paidCurrency: charge.currency, chargeId: charge.externalId, externalId: charge.externalId, fullPaymentAsserted: false, via: given ? "flutterwave webhook" : "flutterwave verify" });
    return "settled";
  }
  // a checkout whose link was never handed out, unknown to Flutterwave: never created
  if (charge.status === "not_found" && !a.checkout_url) {
    await release(db, a.reference, "failed", "checkout never created");
    return "released";
  }
  if (charge.status === "failed") {
    await release(db, a.reference, "failed", charge.reason ?? "payment failed");
    return "released";
  }
  if ((charge.status === "abandoned" || charge.status === "not_found") && Date.now() - Date.parse(a.created_at) > 30 * 60_000) {
    await release(db, a.reference, "abandoned", "checkout abandoned");
    return "released";
  }
  return "pending";
}

/** The Flutterwave webhook's door for an ad reference: the charge was ALREADY re-verified with the API by transaction id. */
export async function handleFlutterwaveAdCharge(db: Db, charge: VerifiedCharge): Promise<string> {
  if (!charge.reference) return "ad charge without reference";
  const { data } = await db.from("ai_topup_attempts").select(ATTEMPT_COLUMNS).eq("reference", charge.reference).eq("purpose", "ad_campaign").maybeSingle();
  const a = data as Attempt | null;
  if (!a || a.provider !== "flutterwave") return "ad attempt not found";
  const out = await askFlutterwave(db, a, charge);
  if (out === "pending") throw new Error("ad payment still pending");
  return `ad ${out}`;
}

/**
 * An attempt whose checkout creation had an unknown outcome. Resolved,
 * never replaced: verify our reference with Paystack. Paid → settle. Exists
 * unpaid → nobody ever saw its page, so it is released (a new attempt is
 * safe). Unknown to Paystack → never created, released. A removed provider's
 * row is held as it is — nothing here can ask Bachs anything any more.
 */
export async function resolveUncertainAttempt(db: Db, a: Attempt): Promise<PaymentStart> {
  if (legacyProvider(a)) return { kind: "verifying", reference: a.reference };
  if (a.status === "pending" && a.checkout_url) return { kind: "redirect", url: a.checkout_url, reference: a.reference, provider: liveProvider(a) };
  if (a.provider === "flutterwave") {
    try {
      const out = await askFlutterwave(db, a);
      return out === "released" ? { kind: "refused", code: "released", status: 409 } : { kind: "verifying", reference: a.reference };
    } catch {
      return { kind: "verifying", reference: a.reference };
    }
  }
  try {
    const charge = await verifyTransaction(a.reference);
    if (charge.status === "success") {
      await settleVerified(db, { reference: a.reference, provider: "paystack", paidAmount: Number(charge.amount), paidCurrency: charge.currency ?? null, chargeId: charge.id ? String(charge.id) : null, externalId: null, fullPaymentAsserted: false, via: "paystack verify" });
      return { kind: "verifying", reference: a.reference };
    }
    await release(db, a.reference, "abandoned", "checkout created but never shown");
    return { kind: "refused", code: "released", status: 409 };
  } catch (e) {
    // Part 4.2: only Paystack's own 4xx ("Transaction reference not found") — a 5xx or a missing key is not proof it was never created
    if (paystackRefusedForSure(e)) {
      // "Transaction reference not found": it was never created
      await release(db, a.reference, "failed", "checkout never created");
      return { kind: "refused", code: "released", status: 409 };
    }
    return { kind: "verifying", reference: a.reference };
  }
}

/* ─────────────────────────────── settle + activate ─────────────────────────────── */

export interface SettleInput {
  reference: string;
  provider: TopupProviderId;
  paidAmount: number | null;
  paidCurrency: string | null;
  chargeId: string | null;
  externalId: string | null;
  /** a provider's own "paid in full" assertion (the SQL's p_full_payment_asserted); Paystack always sends false — the amount is checked */
  fullPaymentAsserted: boolean;
  via: string;
}

/**
 * The one door from "the provider says paid" to "paid campaigns". Callers:
 * the signed webhooks and the verify-on-return (which asked the provider with
 * our secret key). Idempotent in the database; activation idempotent after it.
 */
export async function settleVerified(db: Db, s: SettleInput): Promise<Rpc> {
  const { data, error } = await db.rpc("ad_payment_settle", {
    p_reference: s.reference, p_provider: s.provider, p_paid_amount: s.paidAmount, p_paid_currency: s.paidCurrency,
    p_charge_id: s.chargeId, p_external_id: s.externalId, p_full_payment_asserted: s.fullPaymentAsserted, p_via: s.via,
  });
  if (error) throw new Error(`ad_payment_settle: ${error.message}`);
  const r = data as Rpc;
  if (r.ok) {
    // 0218: the admins hear about the advertiser payment (lib/admin/funding-alerts.ts)
    void import("@/lib/admin/funding-alerts").then((m) => m.flushFundingAlertsSoon()).catch(() => {});
    if (!r.already) log("payment_verified", { reference: s.reference, provider: s.provider, via: s.via });
    const ext = r.extension as { ok?: boolean; reason?: string; campaign_id?: string; new_end_at?: string; already?: boolean } | true | undefined;
    if (ext && typeof ext === "object") {
      // Part 6: an extension payment moves its campaign's end, once (ad_apply_extension)
      if (ext.campaign_id && !ext.already) {
        log(ext.ok ? "campaign_extended" : "extension_held", { reference: s.reference, campaignId: ext.campaign_id, endAt: ext.new_end_at });
        await notifyAdvertiser(db, ext.campaign_id, ext.ok ? { kind: "extended", endAt: ext.new_end_at ?? null } : { kind: "extension_held" });
      }
    } else if (!ext) {
      const ids = (r.campaign_ids as string[] | null) ?? [];
      if (!r.already) for (const id of ids) await notifyAdvertiser(db, id, { kind: "payment_verified" });
      await activatePaidCampaigns(db, ids);
    }
  } else if (r.reason === "mismatch") {
    console.error("[ads-pay] payment_mismatch", { reference: s.reference, provider: s.provider, detail: r.detail, paid: s.paidAmount, currency: s.paidCurrency });
  } else {
    console.warn("[ads-pay] payment_verification_failed", { reference: s.reference, provider: s.provider, reason: r.reason, detail: r.detail });
  }
  return r;
}

/**
 * Make paid campaigns live. Safe to run any number of times: an active
 * campaign answers already_active and is never extended; a failure leaves
 * the campaign paid, to be retried by the next webhook delivery, the
 * advertiser's status check or the admin.
 */
export async function activatePaidCampaigns(db: Db, campaignIds: readonly string[]): Promise<void> {
  for (const id of campaignIds) {
    try {
      log("campaign_activation_started", { campaignId: id });
      // 0208: a video Stream finished since the upload is published first, so it can go live now
      await advanceCampaignProcessing(db, id).catch(() => {});
      const r = await activateCampaign(db, id, { id: null, role: "system" });
      if (r.ok) {
        if (!r.already_active) {
          log("campaign_activated", { campaignId: id, slot: r.slot, end: r.end_at });
          await notifyAdvertiser(db, id, { kind: "activated", endAt: (r.end_at as string | null) ?? null });
        }
      } else {
        console.warn("[ads-pay] campaign_activation_failed", { campaignId: id, reason: r.reason, flags: r.flags });
        if (r.reason === "flagged") await notifyAdvertiser(db, id, { kind: "needs_review" });
      }
    } catch (e) {
      console.error("[ads-pay] campaign_activation_failed", { campaignId: id, error: String(e).slice(0, 200) });
    }
  }
}

/* ─────────────────────────────── status (return) ─────────────────────────────── */

export interface PaymentView {
  reference: string;
  /** "paystack", or a removed provider's name on a historical payment */
  provider: string;
  /** what the advertiser should see */
  state: "verifying" | "paid" | "activating" | "live" | "failed" | "cancelled" | "expired" | "review" | "refunded" | "chargeback";
  paymentStatus: string;
  amountUsdCents: number;
  providerAmount: number | null;
  providerCurrency: string | null;
  campaigns: { id: string; name: string; status: string; startAt: string | null; endAt: string | null; durationDays: number | null; extraDays: number; placement: string | null; format: string | null }[];
  /** Part 6: present when this payment extends an existing campaign */
  extension?: { status: string; days: number; extraDays: number; newEndAt: string | null } | null;
}

/**
 * GET /api/ads/payment/[reference]. Reads our state; when the payment is
 * still pending, asks the PROVIDER (with our key) once - the browser's return
 * proves nothing by itself. Converges with the webhook on the same settle.
 */
export async function adPaymentStatus(db: Db, userId: string, reference: string): Promise<PaymentView | null> {
  const load = async () => (await db.from("ai_topup_attempts").select(ATTEMPT_COLUMNS).eq("reference", reference).eq("purpose", "ad_campaign").maybeSingle()).data as Attempt | null;
  let a = await load();
  if (!a || a.user_id !== userId) return null;

  if ((a.status === "pending" || a.status === "verification_required") && Date.now() - Date.parse(a.created_at) > PROVIDER_CHECK_MIN_AGE_MS) {
    await askProvider(db, a).catch((e) => console.warn("[ads-pay] provider check failed", { reference, error: String(e).slice(0, 160) }));
    a = (await load()) ?? a;
  }

  // Part 6: an extension payment belongs to ONE existing campaign (item_id), not to an application
  const { data: extRow } = await db.from("ad_campaign_extensions").select("status, days, extra_days, new_end_at").eq("payment_reference", reference).maybeSingle();
  const ext = extRow as { status: string; days: number; extra_days: number; new_end_at: string | null } | null;
  const base = db.from("ad_campaigns").select("id, name, status, start_at, end_at, duration_days, extra_days, ad_placements(name, format_code)");
  const { data: rows } = ext ? await base.eq("id", a.item_id) : await base.eq("application_id", a.item_id).eq("payment_reference", reference);
  const campaigns = ((rows ?? []) as unknown as { id: string; name: string; status: string; start_at: string | null; end_at: string | null; duration_days: number | null; extra_days: number; ad_placements: { name: string; format_code: string } | null }[]).map((c) => ({
    id: c.id, name: c.name, status: c.status, startAt: c.start_at, endAt: c.end_at, durationDays: c.duration_days, extraDays: c.extra_days ?? 0, placement: c.ad_placements?.name ?? null, format: c.ad_placements?.format_code ?? null,
  }));

  if (ext) return { ...view(a, campaigns), extension: { status: ext.status, days: ext.days, extraDays: ext.extra_days, newEndAt: ext.new_end_at } };

  // paid but not live yet: activation is retried here (idempotent)
  if (a.status === "success" && campaigns.some((c) => c.status === "paid")) {
    await activatePaidCampaigns(db, campaigns.filter((c) => c.status === "paid").map((c) => c.id));
    return adPaymentStatusNoProbe(db, a, campaigns);
  }
  return view(a, campaigns);
}

async function adPaymentStatusNoProbe(db: Db, a: Attempt, before: PaymentView["campaigns"]): Promise<PaymentView> {
  const { data } = await db.from("ad_campaigns").select("id, status, start_at, end_at").in("id", before.map((c) => c.id));
  const now = new Map(((data ?? []) as { id: string; status: string; start_at: string | null; end_at: string | null }[]).map((c) => [c.id, c]));
  return view(a, before.map((c) => ({ ...c, status: now.get(c.id)?.status ?? c.status, startAt: now.get(c.id)?.start_at ?? c.startAt, endAt: now.get(c.id)?.end_at ?? c.endAt })));
}

export function paymentState(paymentStatus: string, campaignStatuses: readonly string[]): PaymentView["state"] {
  switch (paymentStatus) {
    case "success":
      if (campaignStatuses.length && campaignStatuses.every((s) => s === "active")) return "live";
      if (campaignStatuses.some((s) => s === "validating")) return "review";
      return campaignStatuses.some((s) => s === "paid") ? "activating" : "paid";
    case "failed":
      return "failed";
    case "abandoned":
      return "cancelled";
    case "expired":
      return "expired";
    case "mismatch":
    case "verification_required":
      return paymentStatus === "mismatch" ? "review" : "verifying";
    case "refunded":
    case "partially_refunded":
      return "refunded";
    case "chargeback":
      return "chargeback";
    default:
      return "verifying";
  }
}

function view(a: Attempt, campaigns: PaymentView["campaigns"]): PaymentView {
  return {
    reference: a.reference,
    provider: a.provider,
    state: paymentState(a.status, campaigns.map((c) => c.status)),
    paymentStatus: a.status,
    amountUsdCents: Number(a.amount_cents),
    providerAmount: a.provider_amount === null ? null : Number(a.provider_amount),
    providerCurrency: a.provider_currency,
    campaigns,
  };
}

/** Ask the provider what happened to a pending attempt (verify-on-return, reconciliation). */
/**
 * Part 5 — an admin's "Recheck" of ONE ad payment: exactly the sweep's step (askProvider) for an OPEN attempt, so it
 * settles through the same ad_payment_settle (idempotent) or releases on the same evidence. A settled, released or
 * removed-provider attempt is answered as it stands — never re-asked.
 */
export async function reconcileAdAttempt(db: Db, reference: string): Promise<"checked" | "not_open" | "not_found"> {
  const { data } = await db.from("ai_topup_attempts").select(ATTEMPT_COLUMNS).eq("reference", reference).eq("purpose", "ad_campaign").maybeSingle();
  const a = data as Attempt | null;
  if (!a) return "not_found";
  if (!["pending", "verification_required"].includes(a.status)) return "not_open";
  await askProvider(db, a);
  return "checked";
}

async function askProvider(db: Db, a: Attempt): Promise<void> {
  // a removed provider's row: never re-asked, never released — held for manual reconciliation
  if (legacyProvider(a)) return;
  if (a.status === "verification_required" && !a.checkout_url) {
    await resolveUncertainAttempt(db, a);
    return;
  }
  if (a.provider === "flutterwave") {
    await askFlutterwave(db, a);
    return;
  }
  if (a.provider === "paystack") {
    const charge = await verifyTransaction(a.reference);
    if (charge.status === "success") {
      await settleVerified(db, { reference: a.reference, provider: "paystack", paidAmount: Number(charge.amount), paidCurrency: charge.currency ?? null, chargeId: charge.id ? String(charge.id) : null, externalId: null, fullPaymentAsserted: false, via: "paystack verify" });
    } else if (charge.status === "failed") {
      await release(db, a.reference, "failed", charge.gateway_response ?? "payment failed");
    } else if (charge.status === "abandoned" && Date.now() - Date.parse(a.created_at) > 30 * 60_000) {
      await release(db, a.reference, "abandoned", "checkout abandoned");
    }
    return;
  }
}

/* ─────────────────────────────────── webhooks ─────────────────────────────────── */

/** Paystack charge.success for an ad (purpose frenz_ad_campaign). */
export async function handlePaystackAdCharge(db: Db, data: { reference?: string; amount?: number; currency?: string; id?: number }): Promise<string> {
  if (!data.reference) return "ad charge without reference";
  const r = await settleVerified(db, { reference: data.reference, provider: "paystack", paidAmount: Number(data.amount), paidCurrency: data.currency ?? null, chargeId: data.id ? String(data.id) : null, externalId: null, fullPaymentAsserted: false, via: "paystack webhook" });
  return r.ok ? `ad paid${r.already ? " (again)" : ""}` : `ad not settled: ${r.reason}`;
}

/**
 * Paystack refund.* / charge.dispute.* for an ad. The original reference is
 * read from every place Paystack's payloads carry it (transaction_reference,
 * transaction.reference, reference); an event for any other purpose is not
 * ours and returns null so the existing handlers proceed unchanged.
 */
export async function handlePaystackAdReversal(db: Db, event: string, data: Record<string, unknown>): Promise<string | null> {
  const tx = (data.transaction ?? null) as { reference?: unknown } | null;
  const ref = [data.transaction_reference, tx?.reference, data.reference].find((v): v is string => typeof v === "string" && v.startsWith(AD_PAYSTACK_PREFIX));
  if (!ref) return null;
  let kind: "refund" | "chargeback" | "chargeback_won" | null = null;
  if (event === "refund.processed") kind = "refund";
  else if (event === "charge.dispute.create") kind = "chargeback";
  else if (event === "charge.dispute.resolve") kind = String(data.resolution ?? "").toLowerCase() === "declined" ? "chargeback_won" : "chargeback";
  if (!kind) return "ad reversal: no change";
  const amount = kind === "refund" && typeof data.amount === "number" ? data.amount : null;
  return reverse(db, ref, kind, amount, typeof data.reason === "string" ? data.reason : event);
}

async function reverse(db: Db, reference: string, kind: "refund" | "chargeback" | "chargeback_won", amount: number | null, reason: string): Promise<string> {
  const { data, error } = await db.rpc("ad_payment_reverse", { p_reference: reference, p_kind: kind, p_amount: amount, p_reason: reason.slice(0, 200) });
  if (error) throw new Error(`ad_payment_reverse: ${error.message}`);
  const r = data as Rpc;
  console.warn(`[ads-pay] ${kind === "refund" ? "payment_refunded" : "payment_chargeback"}`, { reference, kind, status: r.status, ok: r.ok, reason: r.reason });
  return `ad ${kind}: ${r.ok ? r.status : r.reason}`;
}

/* ─────────────────────────────── reconciliation ─────────────────────────────── */

/**
 * Confirm pending ad payments with the PROVIDER, with nobody watching
 * (2026-10-09: a payment succeeded, the webhook never arrived, and the
 * attempt stayed "pending" because the only fallback check ran while the
 * return page was open — and the page stops asking after a minute). Run by
 * the 10-minute reconcile cron and the hourly housekeeping. Paystack rows
 * only: a removed provider's rows are held for a person.
 *
 * Bounded: attempts between 2 minutes (give the webhook its chance) and 48
 * hours old, at most 25 per run, oldest first. Each goes through the same
 * askProvider → settleVerified → activation path the return page uses, so the
 * provider stays the only authority and a run can never double-settle.
 */
export async function reconcilePendingAdPayments(db: Db, now: number = Date.now()): Promise<{ checked: number; settled: number }> {
  const { data } = await db
    .from("ai_topup_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("purpose", "ad_campaign")
    .in("provider", ["paystack", "flutterwave"])
    .in("status", ["pending", "verification_required"])
    .lt("created_at", new Date(now - 2 * 60_000).toISOString())
    .gt("created_at", new Date(now - 48 * 3_600_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(25);
  const attempts = (data ?? []) as Attempt[];
  let settled = 0;
  for (const a of attempts) {
    try {
      await askProvider(db, a);
      const { data: after } = await db.from("ai_topup_attempts").select("status").eq("reference", a.reference).maybeSingle();
      if (after?.status === "success") settled += 1;
    } catch (e) {
      console.warn("[ads-pay] reconcile check failed", { reference: a.reference, error: String(e).slice(0, 160) });
    }
  }
  if (attempts.length) console.info("[ads-pay] reconciled", { checked: attempts.length, settled });
  return { checked: attempts.length, settled };
}
