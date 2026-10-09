import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import type { PaymentMarket, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { getLandingSettings } from "@/lib/landing/settings";
import { bachsCheckoutRequest, bachsConfigured, bachsFailureIsDefinite, bachsStatusIsPaid, decimalToMinor, getBachsCheckout, postBachsCheckout } from "@/lib/payments/bachs";
import { routePayment } from "@/lib/payments/router";
import { initializeAdCheckout, paystackEnabled, paystackFailureIsDefinite, verifyTransaction } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";

import { notifyAdvertiser } from "./ad-notify";

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
 * ── The fallback rule (owner: "never automatically fallback after an
 *    ambiguous Bachs transaction") ─────────────────────────────────────────
 * A provider is followed by the next ONLY when it REFUSED (a 4xx / Paystack's
 * own message: nothing was created). A timeout, a network drop, a 5xx or
 * IDEMPOTENCY_IN_PROGRESS is UNKNOWN: the attempt becomes
 * verification_required and the application stays in payment_processing.
 * It is resolved, never replaced: Bachs by replaying the STORED request with
 * the SAME Idempotency-Key within 24 h (docs.bachs.io/guides/idempotency),
 * Paystack by verifying our own reference.
 */

type Db = SupabaseClient;
type Rpc = { ok: boolean; reason?: string; [k: string]: unknown };

export const AD_BACHS_PREFIX = "frenz_bachs_ad_"; // readBachsAttempt() recognises "frenz_bachs_"
export const AD_PAYSTACK_PREFIX = "frenz_ad_";
const BACHS_IDEMPOTENCY_WINDOW_MS = 23 * 3600_000; // inside Bachs's 24 h replay cache, with margin
const PROVIDER_CHECK_MIN_AGE_MS = 5_000;

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
  provider: TopupProviderId;
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
    if (open.status === "pending" && open.checkout_url) return { kind: "redirect", url: open.checkout_url, reference: open.reference, provider: open.provider };
    const resolved = await resolveUncertainAttempt(db, open);
    if (resolved.kind !== "refused" || resolved.code !== "released") return resolved;
  }

  // the creative and the link are re-checked right before money moves
  const { data: creatives } = await db.from("ad_creatives").select("validation_status, url_validation_status, destination_url").eq("campaign_id", applicationId).eq("status", "active");
  const cr = creatives?.[0];
  // a link waiting on a person (Part 8 'pending') may be paid for - it goes live only after approval
  if (!cr || cr.validation_status !== "valid" || !["valid", "pending"].includes(cr.url_validation_status as string) || !cr.destination_url) return { kind: "refused", code: "creative_not_valid", status: 409 };
  const dest = await checkDestination(db, cr.destination_url as string);
  if (dest.status === "blocked") return { kind: "refused", code: "destination_blocked", status: 409 };

  const { data: quote } = await db.from("ad_payment_quotes").select("id, total_minor, currency, status, expires_at").eq("id", input.quoteId).eq("application_id", applicationId).maybeSingle();
  if (!quote || quote.status !== "open") return { kind: "refused", code: "quote_invalid", status: 409 };
  if (Date.parse(quote.expires_at as string) <= Date.now()) return { kind: "refused", code: "quote_expired", status: 409 };
  const totalUsd = Number(quote.total_minor);

  const landing = await getLandingSettings();
  const paystackOk = await paystackEnabled();
  const candidates = routePayment({
    purpose: "ad_campaign",
    market: input.market,
    routing: landing.frenzAiPlans.wallet.routing,
    usable: (p) => (p === "bachs" ? bachsConfigured() : paystackOk),
    preferred: landing.frenzAiPlans.wallet.memberChoice ? input.preferredProvider : undefined,
  });
  if (!candidates.length) return { kind: "refused", code: "payments_unavailable", status: 503 };

  return firstCheckout(candidates, (provider, i) => {
    log("payment_provider_selected", { applicationId, provider, attempt: i + 1, market: input.market });
    return provider === "bachs" ? beginBachs(db, input, applicationId, input.quoteId, totalUsd) : beginPaystack(db, input, applicationId, input.quoteId, totalUsd, landing);
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
  return { kind: "refused", code: "payment_not_started", status: 502 };
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
      if (open?.checkout_url) return { kind: "redirect", url: open.checkout_url, reference: open.reference, provider: open.provider };
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

async function beginBachs(db: Db, input: { userId: string; email: string }, applicationId: string, quoteId: string, totalUsd: number): Promise<PaymentStart> {
  const reference = `${AD_BACHS_PREFIX}${randomUUID()}`;
  const body = bachsCheckoutRequest({
    amountUsdCents: totalUsd,
    email: input.email,
    reference,
    metadata: { purpose: "frenz_ad_campaign", application_id: applicationId, quote_id: quoteId, user_id: input.userId },
    successUrl: returnUrl(reference),
    cancelUrl: returnUrl(reference),
  });
  const stop = await begin(db, input, applicationId, quoteId, reference, "bachs", totalUsd, "USD", totalUsd, null, { quoted_usd_cents: totalUsd });
  if (stop) return stop;
  // the exact request is stored BEFORE it is sent: it is the recovery for an uncertain write
  await db.from("ai_topup_attempts").update({ provider_request: body }).eq("reference", reference);
  try {
    const checkout = await postBachsCheckout(body, reference);
    await db.from("ai_topup_attempts").update({ external_id: checkout.checkoutId, checkout_url: checkout.url, updated_at: new Date().toISOString() }).eq("reference", reference);
    log("payment_session_created", { provider: "bachs", reference, applicationId });
    return { kind: "redirect", url: checkout.url, reference, provider: "bachs" };
  } catch (e) {
    if (bachsFailureIsDefinite(e)) {
      await release(db, reference, "failed", "checkout refused by provider");
      console.warn("[ads-pay] provider refused checkout", { provider: "bachs", reference, error: String(e).slice(0, 200) });
      return { kind: "refused", code: "provider_refused", status: 502 };
    }
    // 🔴 UNKNOWN: Bachs may have created it. No fallback - resolve this one.
    await release(db, reference, "verification_required", "checkout outcome unknown");
    console.warn("[ads-pay] checkout outcome unknown — held for verification", { provider: "bachs", reference, error: String(e).slice(0, 200) });
    return { kind: "verifying", reference };
  }
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
      return { kind: "refused", code: "provider_refused", status: 502 };
    }
    await release(db, reference, "verification_required", "checkout outcome unknown");
    console.warn("[ads-pay] checkout outcome unknown — held for verification", { provider: "paystack", reference, error: String(e).slice(0, 200) });
    return { kind: "verifying", reference };
  }
}

/**
 * An attempt whose checkout creation had an unknown outcome. Resolved,
 * never replaced:
 *   Bachs     replay the STORED body with the SAME key while Bachs still
 *             holds the reply (24 h). Past that, a person decides.
 *   Paystack  verify our reference. Paid → settle. Exists unpaid → nobody
 *             ever saw its page, so it is released (a new attempt is safe).
 *             Unknown to Paystack → never created, released.
 */
export async function resolveUncertainAttempt(db: Db, a: Attempt): Promise<PaymentStart> {
  if (a.status === "pending" && a.checkout_url) return { kind: "redirect", url: a.checkout_url, reference: a.reference, provider: a.provider };
  if (a.provider === "bachs") {
    if (!a.provider_request || Date.now() - Date.parse(a.created_at) > BACHS_IDEMPOTENCY_WINDOW_MS) return { kind: "verifying", reference: a.reference };
    try {
      const checkout = await postBachsCheckout(a.provider_request, a.reference);
      await db.from("ai_topup_attempts").update({ status: "pending", status_reason: null, external_id: checkout.checkoutId, checkout_url: checkout.url, updated_at: new Date().toISOString() }).eq("reference", a.reference).eq("status", "verification_required");
      log("payment_session_recovered", { provider: "bachs", reference: a.reference });
      return { kind: "redirect", url: checkout.url, reference: a.reference, provider: "bachs" };
    } catch (e) {
      if (bachsFailureIsDefinite(e)) {
        await release(db, a.reference, "failed", "checkout refused on recovery");
        return { kind: "refused", code: "released", status: 409 };
      }
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
    if (paystackFailureIsDefinite(e)) {
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
  /** Bachs only: its SUCCEEDED collection on OUR checkout session = paid in full (an underpayment is collection.underpaid). */
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
  provider: TopupProviderId;
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
async function askProvider(db: Db, a: Attempt): Promise<void> {
  if (a.status === "verification_required" && !a.checkout_url) {
    await resolveUncertainAttempt(db, a);
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
  if (!a.external_id) return;
  const session = await getBachsCheckout(a.external_id);
  if (session.reference && session.reference !== a.reference) return;
  if (bachsStatusIsPaid(session.status)) {
    await settleVerified(db, { reference: a.reference, provider: "bachs", paidAmount: null, paidCurrency: null, chargeId: null, externalId: a.external_id, fullPaymentAsserted: true, via: "bachs verify" });
  } else if (/^(expired|canceled|cancelled)$/i.test(session.status)) {
    await release(db, a.reference, "expired", `checkout ${session.status.toLowerCase()}`);
  }
}

/* ─────────────────────────────────── webhooks ─────────────────────────────────── */

/** Bachs collection.* for an ad attempt. The signature was verified by the route. */
export async function handleBachsAdCollection(db: Db, type: string, data: Record<string, unknown>, attempt: { reference: string; external_id: string | null }): Promise<string> {
  const checkoutId = typeof data.checkout_id === "string" ? data.checkout_id : null;
  const chargeId = typeof data.charge_id === "string" ? data.charge_id : null;
  if (type === "collection.failed") {
    await release(db, attempt.reference, "failed", typeof data.failure_reason === "string" ? data.failure_reason.slice(0, 200) : "payment failed");
    return "ad payment failed";
  }
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : null;
  if (type === "collection.underpaid") {
    const r = await settleVerified(db, { reference: attempt.reference, provider: "bachs", paidAmount: decimalToMinor(data.amount_paid), paidCurrency: currency, chargeId, externalId: checkoutId, fullPaymentAsserted: false, via: "bachs underpaid" });
    return `ad underpaid: ${r.reason ?? "?"}`;
  }
  const succeeded = String(data.status ?? "").toUpperCase() === "SUCCEEDED";
  const r = await settleVerified(db, {
    reference: attempt.reference,
    provider: "bachs",
    paidAmount: decimalToMinor(data.amount),
    paidCurrency: currency,
    chargeId,
    externalId: checkoutId,
    fullPaymentAsserted: succeeded && !!checkoutId && checkoutId === attempt.external_id,
    via: "bachs webhook",
  });
  return r.ok ? `ad paid${r.already ? " (again)" : ""}` : `ad not settled: ${r.reason}`;
}

/** Bachs refund.paid / dispute.* — matched by the provider charge id we stored at settlement. */
export async function handleBachsAdReversal(db: Db, type: string, data: Record<string, unknown>): Promise<string | null> {
  const chargeId = typeof data.charge_id === "string" ? data.charge_id : null;
  if (!chargeId) return null;
  const { data: a } = await db.from("ai_topup_attempts").select("reference").eq("provider", "bachs").eq("charge_id", chargeId).eq("purpose", "ad_campaign").maybeSingle();
  if (!a) return null;
  let kind: "refund" | "chargeback" | "chargeback_won" | null = null;
  if (type === "refund.paid") kind = "refund";
  else if (type === "dispute.created") kind = "chargeback";
  else if (type === "dispute.updated") {
    const s = String(data.status ?? "").toLowerCase();
    kind = s === "won" || s === "closed" ? "chargeback_won" : s === "lost" ? "chargeback" : null;
  }
  if (!kind) return "ad reversal: no change";
  const amount = kind === "refund" ? decimalToMinor(data.refunded_amount ?? data.requested_amount) : null;
  return reverse(db, a.reference as string, kind, amount, typeof data.reason === "string" ? data.reason : type);
}

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
