import "server-only";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import type { PaymentMarket, TopupProviderId } from "@/lib/ai/credits/wallet-config";
import { depositRulesForDb, type FrenzCoinConfig } from "@/lib/coin/config";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY, flutterwaveCollectionGate, flutterwaveConfigured, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { chargeMatches, type VerifiedCharge } from "@/lib/payments/charge";
import { flutterwaveChargeFor } from "@/lib/payments/flutterwave-charge";
import { flutterwaveReferencePurpose, newFlutterwaveReference } from "@/lib/payments/references";
import { offeredProviders, routePayment } from "@/lib/payments/router";
import { initializeCoinDepositCheckout, paystackEnabled, paystackFailureIsDefinite, paystackRefusedForSure, verifyTransaction } from "@/lib/paystack/paystack";
import { getLandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN DEPOSITS — through the existing Flutterwave collection (Frenz Coin Part 4, 0280)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same rail and the same rules as a Flutterwave AI-credit top-up (lib/ai/wallet/flutterwave-settle.ts), on the same
 * attempt ledger (ai_topup_attempts, purpose `coin_deposit`), with three differences:
 *   · it credits the FRENZ COIN wallet only (settle_coin_deposit), never AI Credits, and never through
 *     credit_product_balance — so no AI top-up reward, bonus or affiliate commission can follow it;
 *   · the coins land PENDING for the admin's hold (1 hour by default, 0 to 2160 - 0284), by the database clock;
 *   · the amount is the coins (1 coin = $1 = 100 cents). Charged in USD — or, since 2026-10-26 (owner: "it should also
 *     take effect for the Frenz coin deposit"), in the member's own currency in Nigeria, Ghana, Kenya and South Africa, at
 *     the same rate every other one-off checkout uses (lib/payments/flutterwave-charge.ts). The coins credited are still
 *     the USD amount; the row pins the local amount Flutterwave must collect.
 *
 *   beginCoinDeposit     the attempt row (begin_coin_deposit) BEFORE the checkout, then the checkout. One open deposit
 *                        per member; a replayed idempotency key returns the attempt it made.
 *   settleCoinDeposit    Flutterwave is asked about OUR reference (or the webhook hands over the charge it verified by
 *                        id); the charge must match the attempt exactly (chargeMatches, then again in SQL). Callers: the
 *                        webhook, the return route, the reconcile sweep — all idempotent on the reference.
 *   reconcileCoinDeposits / releaseDueCoinDeposits   the 10-minute ai-reconcile cron: open attempts asked again, due
 *                        deposits released. A member's own wallet read also releases their due deposits.
 *   reversals            Flutterwave sends no documented refund or chargeback event to this integration: anything that
 *                        looks like one is logged for an admin, who records the reversal after checking the dashboard
 *                        (the original charge is re-verified first). reverse_coin_deposit does the accounting.
 *
 * ── PAYSTACK TOO (0299, owner 2026-10-27) ──────────────────────────────────
 * "Make Nigeria users use Paystack as first choice of payment, deposit … but they can decide to switch." A deposit asks
 * the payment router (purpose wallet_topup — a deposit IS a wallet top-up): in Nigeria Paystack first, elsewhere
 * Flutterwave first, the member's pick reordering the two when the admin lets members choose. Paystack charges its
 * checkout currency (naira) at the same live rate every other Paystack checkout uses (resolveCheckoutRate + quoteCheckout),
 * pinned on the same attempt row, settled by the same settle_coin_deposit on exactly that amount — so a Paystack deposit
 * lands on the same hold, under the same rules. Its references are frenz_coin_dep_<uuid> (no _fw_), so a Flutterwave
 * webhook can never settle one and the other way round. The second rail is tried only after a DEFINITE refusal.
 *
 * Nothing here trusts a browser: the member is the session, the amount is the server's, the outcome is the provider's.
 */

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const CANCEL_AFTER_MS = 30 * 60_000;
const OPEN = ["pending", "verification_required"] as const;
const MISSING = (m: string) => /begin_coin_deposit|settle_coin_deposit|release_due_coin_deposits|reverse_coin_deposit|coin_deposit|schema cache|does not exist/i.test(m);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** 0299: a Paystack coin deposit's reference — our own, no _fw_ (Flutterwave's are frenz_coin_dep_fw_<uuid>). */
const PAYSTACK_COIN_REF = /^frenz_coin_dep_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isPaystackCoinDepositReference = (r: unknown): r is string => typeof r === "string" && PAYSTACK_COIN_REF.test(r);
export const isCoinDepositReference = (r: unknown): r is string => flutterwaveReferencePurpose(r) === "coin_deposit" || isPaystackCoinDepositReference(r);
/** The rail a coin deposit reference was minted for — never guessed from anything else. */
export const coinDepositProviderOf = (r: unknown): TopupProviderId | null => (isPaystackCoinDepositReference(r) ? "paystack" : flutterwaveReferencePurpose(r) === "coin_deposit" ? "flutterwave" : null);

type Fail = { ok: false; status: number; reason: string; error: string };
const fail = (status: number, reason: string, error: string): Fail => ({ ok: false, status, reason, error });

export type CoinDepositStart = { ok: true; url: string; reference: string; amountCents: number; holdHours: number; reused: boolean } | Fail;

/** The member returns here from the checkout (the wallet page verifies the reference; the webhook settles regardless). */
export const coinDepositReturnUrl = (reference: string) => `${SITE_URL}/wallet?deposit=${encodeURIComponent(reference)}`;

/** The rails a coin deposit may use for this member, in order (the router's; the checkout re-decides from scratch). */
async function coinDepositRails(): Promise<{ usable: (p: TopupProviderId) => boolean; routing: Awaited<ReturnType<typeof getLandingSettings>>["frenzAiPlans"]["wallet"] }> {
  const [fw, ps, landing] = await Promise.all([getFlutterwaveConfig(), paystackEnabled(), getLandingSettings()]);
  const fwOk = flutterwaveCollectionGate(FLUTTERWAVE_CHECKOUT_CURRENCY, fw).ok;
  return { usable: (p) => (p === "flutterwave" ? fwOk : p === "paystack" && ps), routing: landing.frenzAiPlans.wallet };
}

/** Which providers the deposit sheet may offer (a choice is shown only when there are two). Display only. */
export async function coinDepositOptions(market: PaymentMarket | undefined): Promise<TopupProviderId[]> {
  const { usable, routing } = await coinDepositRails();
  return offeredProviders({ purpose: "wallet_topup", market: market ?? "other", routing: routing.routing, memberChoice: routing.memberChoice, usable });
}

/**
 * Open a Frenz Coin deposit for the signed-in member. `amountCents` and `idempotencyKey` come from the request and are
 * validated here and again in SQL; `provider` is only the member's pick among the rails the router offers; everything
 * else is the server's.
 */
export async function beginCoinDeposit(opts: { userId: string; email: string; amountCents: unknown; idempotencyKey: unknown; config: FrenzCoinConfig; market?: PaymentMarket; country?: string | null; provider?: unknown }): Promise<CoinDepositStart> {
  const c = opts.config;
  if (!c.enabled || !c.deposits.enabled) return fail(503, "disabled", "Frenz Coin deposits aren't available right now.");
  const amount = opts.amountCents;
  const key = opts.idempotencyKey;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || typeof key !== "string" || !KEY.test(key)) return fail(400, "invalid", "That request isn't valid.");
  if (amount < c.deposits.minCents || amount > c.deposits.maxCents) return fail(400, "amount_out_of_range", `Deposit between ${usd(c.deposits.minCents)} and ${usd(c.deposits.maxCents)}.`);

  const { usable, routing } = await coinDepositRails();
  const candidates = routePayment({ purpose: "wallet_topup", market: opts.market ?? "other", routing: routing.routing, usable, preferred: routing.memberChoice ? opts.provider : undefined });
  if (!candidates.length) return fail(503, "rail_unavailable", "Deposits aren't available right now.");
  let last: Opened = { out: fail(503, "rail_unavailable", "Deposits aren't available right now."), next: true, wrote: false };
  let usedKey = key;
  for (const [i, provider] of candidates.entries()) {
    last = provider === "paystack" ? await openPaystackDeposit(opts, amount, usedKey, c) : await openFlutterwaveDeposit(opts, amount, usedKey, c);
    if (last.out.ok || !last.next) return last.out;
    const to = candidates[i + 1];
    if (to) console.warn("[payments] fallback_triggered", { purpose: "coin_deposit", from: provider, to, userId: opts.userId });
    // the refused attempt keeps its key (a replay finds it); the next rail's attempt is its own
    if (last.wrote) usedKey = `${key.slice(0, 74)}-alt${i + 1}`;
  }
  return last.out;
}

/** `next`: the rail DEFINITELY created nothing, so the next one may be tried. `wrote`: an attempt row now holds the key. */
type Opened = { out: CoinDepositStart; next: boolean; wrote: boolean };

/** The attempt row, BEFORE any checkout (begin_coin_deposit). A replayed key, or a checkout still open, answers here. */
async function beginAttempt(opts: { userId: string }, provider: TopupProviderId, reference: string, amount: number, charge: { amountMinor: number; currency: string }, key: string, c: FrenzCoinConfig): Promise<{ ok: true; holdHours: number } | { ok: false; out: CoinDepositStart }> {
  const { data, error } = await createAdminClient().rpc("begin_coin_deposit", {
    p_user: opts.userId,
    p_reference: reference,
    p_amount_cents: amount,
    p_provider: provider,
    p_provider_amount: charge.amountMinor,
    p_provider_currency: charge.currency,
    p_idempotency: key,
    p_rules: depositRulesForDb(c),
  });
  if (error) {
    if (MISSING(error.message)) return { ok: false, out: fail(503, "not_available", "Frenz Coin deposits arrive with the next update.") };
    console.error("[coin/deposit] begin failed", { userId: opts.userId, code: error.code });
    return { ok: false, out: fail(503, "error", "Couldn't start that deposit. Nothing was charged.") };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; reference?: string; status?: string; checkout_url?: string | null; hold_hours?: number };
  if (r.ok) return { ok: true, holdHours: Number(r.hold_hours ?? c.deposits.holdHours) };
  // an earlier request (the same key, or a checkout still open): hand back its link when it has one, never a second checkout
  if ((r.reason === "existing" || r.reason === "open") && r.reference) {
    if (r.checkout_url && (r.status === "pending" || r.status === undefined)) return { ok: false, out: { ok: true, url: r.checkout_url, reference: r.reference, amountCents: amount, holdHours: c.deposits.holdHours, reused: true } };
    if (r.status === "success") return { ok: false, out: fail(409, "already_paid", "That deposit was already paid.") };
    return { ok: false, out: fail(409, "in_progress", "Your last deposit is still being confirmed. Try again in a few minutes.") };
  }
  const map: Record<string, [number, string]> = {
    idempotency_conflict: [409, "That request key was already used. Try again."],
    rules_invalid: [503, "Frenz Coin isn't configured correctly. Nothing was charged."],
    disabled: [503, "Frenz Coin deposits aren't available right now."],
    amount_out_of_range: [400, `Deposit between ${usd(c.deposits.minCents)} and ${usd(c.deposits.maxCents)}.`],
    suspended: [403, "Deposits are paused on this account."],
    invalid: [400, "That request isn't valid."],
  };
  const [status, msg] = map[r.reason ?? ""] ?? [409, "Couldn't start that deposit."];
  return { ok: false, out: fail(status, r.reason ?? "error", msg) };
}

/** A checkout the provider definitely refused, or whose outcome is unknown: the attempt is closed or held, never left open. */
async function closeAttempt(reference: string, provider: TopupProviderId, definite: boolean): Promise<void> {
  await createAdminClient()
    .from("ai_topup_attempts")
    .update(definite ? { status: "failed", status_reason: `${provider} refused the checkout`, updated_at: new Date().toISOString() } : { status: "verification_required", status_reason: `${provider} checkout outcome unknown`, updated_at: new Date().toISOString() })
    .eq("reference", reference)
    .eq("status", "pending");
}

const refusedOut = (definite: boolean) => (definite ? fail(503, "checkout_refused", "We couldn't start that payment. Try again.") : fail(503, "checkout_unknown", "We couldn't confirm the payment page opened. Nothing more will be charged — try again in a few minutes."));

async function openFlutterwaveDeposit(opts: { userId: string; email: string; market?: PaymentMarket; country?: string | null }, amount: number, key: string, c: FrenzCoinConfig): Promise<Opened> {
  /*
    The member's own currency (2026-10-26, owner: "it should also take effect for the Frenz coin deposit"): in Nigeria
    naira, in Ghana / Kenya / South Africa cedis, shillings or rand — their cards often refuse dollars, and the local
    currency brings bank transfer, USSD, mobile money. The wallet is still credited the USD amount asked for; the row
    pins what Flutterwave must collect, and settle_coin_deposit settles only on exactly that amount in that currency.
  */
  const charge = await flutterwaveChargeFor(amount, opts.market, "coin_deposit", opts.country);
  const reference = newFlutterwaveReference("coin_deposit");
  // 🔴 written BEFORE the provider is called: a checkout never exists without its attempt row
  const begun = await beginAttempt(opts, "flutterwave", reference, amount, charge, key, c);
  if (!begun.ok) return { out: begun.out, next: false, wrote: false };
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: charge.amountMinor, currency: charge.currency, email: opts.email, redirectUrl: coinDepositReturnUrl(reference), title: "Frenz Coin", meta: { purpose: "coin_deposit" } });
    await createAdminClient().from("ai_topup_attempts").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    console.info("[payments] checkout_created", { provider: "flutterwave", purpose: "coin_deposit", userId: opts.userId, reference });
    return { out: { ok: true, url, reference, amountCents: amount, holdHours: begun.holdHours, reused: false }, next: false, wrote: true };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    await closeAttempt(reference, "flutterwave", definite);
    // never the provider's message: it can carry the request back
    console.error("[coin/deposit] flutterwave initialize failed", { userId: opts.userId, reference, definite, error: e instanceof Error ? e.name : "unknown" });
    return { out: refusedOut(definite), next: definite, wrote: true };
  }
}

/** 0299: the Paystack rail — its checkout currency (naira) at the live rate every Paystack checkout uses; no rate, no checkout. */
async function openPaystackDeposit(opts: { userId: string; email: string }, amount: number, key: string, c: FrenzCoinConfig): Promise<Opened> {
  const cr = (await getLandingSettings()).frenzAiCharacterReplace;
  const rate = await resolveCheckoutRate(cr, "USD");
  const noRate: Opened = { out: fail(503, "rail_unavailable", "Deposits aren't available right now."), next: true, wrote: false };
  if (rate && "error" in rate) return noRate;
  // `recharge.checkoutCurrency` is PAYSTACK's checkout currency (NGN: the Paystack account is in naira), never Flutterwave's
  const q = quoteCheckout({ walletAmountCents: amount, walletCurrency: "USD", checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in q) return noRate;
  const reference = `frenz_coin_dep_${crypto.randomUUID()}`;
  const begun = await beginAttempt(opts, "paystack", reference, amount, { amountMinor: q.amount, currency: q.currency }, key, c);
  if (!begun.ok) return { out: begun.out, next: false, wrote: false };
  try {
    const url = await initializeCoinDepositCheckout({ email: opts.email, userId: opts.userId, amount: q.amount, currency: q.currency, reference, callbackUrl: coinDepositReturnUrl(reference), metadata: { coin_cents: amount, fx_minor_per_usd: q.minorPerUsd || null } });
    await createAdminClient().from("ai_topup_attempts").update({ checkout_url: url, fx_minor_per_usd: q.minorPerUsd || null, updated_at: new Date().toISOString() }).eq("reference", reference);
    console.info("[payments] checkout_created", { provider: "paystack", purpose: "coin_deposit", userId: opts.userId, reference });
    return { out: { ok: true, url, reference, amountCents: amount, holdHours: begun.holdHours, reused: false }, next: false, wrote: true };
  } catch (e) {
    const definite = paystackFailureIsDefinite(e);
    await closeAttempt(reference, "paystack", definite);
    console.error("[coin/deposit] paystack initialize failed", { userId: opts.userId, reference, definite, error: e instanceof Error ? e.name : "unknown" });
    return { out: refusedOut(definite), next: definite, wrote: true };
  }
}

/**
 * 0299: Paystack's verify, in the one vocabulary every settle path speaks. A reference Paystack answers with a 4xx for
 * ("Transaction reference not found") is not_found; anything else unreadable THROWS, so the caller retries.
 */
export async function verifyPaystackCoinCharge(reference: string): Promise<VerifiedCharge> {
  let c;
  try {
    c = await verifyTransaction(reference);
  } catch (e) {
    if (paystackRefusedForSure(e)) return { provider: "paystack", reference, externalId: null, status: "not_found", amountMinor: null, currency: null, channel: null, paidAt: null, reason: null };
    throw e;
  }
  const word = String(c.status ?? "").toLowerCase();
  const status: VerifiedCharge["status"] = word === "success" ? "success" : word === "failed" || word === "reversed" ? "failed" : word === "abandoned" ? "abandoned" : "pending";
  return {
    provider: "paystack",
    reference: typeof c.reference === "string" ? c.reference : null,
    externalId: c.id != null ? String(c.id) : null,
    status,
    amountMinor: typeof c.amount === "number" ? c.amount : null,
    currency: typeof c.currency === "string" ? c.currency.toUpperCase() : null,
    channel: c.channel ?? null,
    paidAt: c.paid_at ?? null,
    reason: c.gateway_response ?? null,
    customerEmail: c.customer?.email ? c.customer.email.toLowerCase() : null,
  };
}

interface AttemptRow {
  reference: string;
  user_id: string;
  provider: string;
  status: string;
  amount_cents: number;
  provider_amount: number | null;
  provider_currency: string | null;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
}
const ROW = "reference, user_id, provider, status, amount_cents, provider_amount, provider_currency, checkout_url, created_at, updated_at";

export type CoinDepositSettle =
  | { kind: "credited"; amountCents: number; releaseAt: string; duplicate: boolean }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "mismatch" }
  | { kind: "review" }
  | { kind: "not_ours" }
  | { kind: "unknown" }
  | { kind: "error" };

async function setOpenStatus(reference: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient().from("ai_topup_attempts").update({ ...patch, updated_at: new Date().toISOString() }).eq("reference", reference).in("status", [...OPEN]);
  if (error) console.error("[coin/deposit] attempt update failed", { reference });
}

async function audit(action: string, reference: string, details: Record<string, unknown>): Promise<boolean> {
  const { error } = await createAdminClient().from("financial_audit_log").insert({ action, target_type: "coin_deposit", target_id: reference, reference, details });
  return !error;
}

/**
 * Settle one coin deposit. `charge`, when given, is one the caller ALREADY verified with the provider (the Flutterwave
 * webhook, by transaction id); otherwise the rail that collected it (the ROW's provider) is asked about our reference
 * here. `userId`, when given, must own the attempt. Throws only when the provider cannot be reached (the caller retries);
 * a database error is `error`.
 */
export async function settleCoinDeposit(reference: string, opts: { userId?: string; charge?: VerifiedCharge } = {}): Promise<CoinDepositSettle> {
  if (!isCoinDepositReference(reference)) return { kind: "unknown" };
  const db = createAdminClient();
  const { data, error } = await db.from("ai_topup_attempts").select(ROW).eq("reference", reference).eq("purpose", "coin_deposit").maybeSingle();
  if (error) return { kind: "error" };
  const row = data as AttemptRow | null;
  // the row names its rail, and so must the reference — and a charge handed over must come from that same rail
  const provider = coinDepositProviderOf(reference);
  if (!row || !provider || row.provider !== provider || (opts.charge && opts.charge.provider !== provider)) return { kind: "unknown" };
  if (opts.userId && row.user_id !== opts.userId) {
    console.warn("[coin/deposit] reference does not belong to caller", { reference });
    return { kind: "not_ours" };
  }

  const charge = opts.charge ?? (provider === "paystack" ? await verifyPaystackCoinCharge(reference) : await verifyFlutterwaveByReference(reference));
  if (charge.status === "success") {
    const expected = { provider, reference, amountMinor: Number(row.provider_amount ?? row.amount_cents), currency: row.provider_currency ?? FLUTTERWAVE_CHECKOUT_CURRENCY };
    const match = chargeMatches(charge, expected);
    if (!match.ok) {
      // money may have moved, but not what was asked: nothing is credited, a person reviews it
      console.error("[coin/deposit] verified charge does not match the attempt", { reference, mismatch: match.mismatch });
      await setOpenStatus(reference, { status: "mismatch", status_reason: `${provider} ${match.mismatch}`, paid_amount: charge.amountMinor, paid_currency: charge.currency, charge_id: charge.externalId });
      await audit("coin_deposit_mismatch", reference, { mismatch: match.mismatch, expected_minor: expected.amountMinor, expected_currency: expected.currency, paid_minor: charge.amountMinor, paid_currency: charge.currency });
      return { kind: "mismatch" };
    }
    // 🔴 the coins credited are the amount WE stored on the attempt; the SQL re-checks the paid amount against it
    const { data: s, error: e } = await db.rpc("settle_coin_deposit", { p_reference: reference, p_charge_id: charge.externalId, p_paid_minor: charge.amountMinor, p_paid_currency: charge.currency });
    if (e) {
      console.error("[coin/deposit] settle failed", { reference, code: e.code });
      return { kind: "error" };
    }
    const out = (s ?? {}) as { ok?: boolean; reason?: string; amount?: number; release_at?: string; duplicate?: boolean };
    if (out.ok) return { kind: "credited", amountCents: Number(out.amount), releaseAt: String(out.release_at), duplicate: !!out.duplicate };
    if (out.reason === "mismatch") return { kind: "mismatch" };
    if (out.reason === "not_settleable") return { kind: "review" };
    return { kind: "error" };
  }

  // the provider no longer says "paid" about a deposit we settled (a refund?): logged for a person, nothing changes here
  if (row.status === "success") {
    await audit("coin_deposit_provider_status_review", reference, { provider_status: charge.status, review: `A settled coin deposit is no longer shown as paid. Check the ${provider === "paystack" ? "Paystack" : "Flutterwave"} dashboard; record any refund in Admin.` });
    return { kind: "review" };
  }
  const age = Date.now() - Date.parse(row.created_at);
  // a checkout whose creation outcome was unknown, and the provider holds nothing for it: nobody could have paid it
  if (charge.status === "not_found" && !row.checkout_url) {
    await setOpenStatus(reference, { status: "failed", status_reason: `${provider} checkout never created` });
    return { kind: "failed" };
  }
  if (charge.status === "failed" || ((charge.status === "abandoned" || charge.status === "not_found") && age >= CANCEL_AFTER_MS)) {
    await setOpenStatus(reference, { status: charge.status === "failed" ? "failed" : "abandoned", gateway_response: charge.reason, channel: charge.channel });
    return { kind: "failed" };
  }
  return { kind: "pending" };
}

/** Release a member's (or everyone's) deposits whose hold is over. The database decides "over" by its own clock. */
export async function releaseDueCoinDeposits(userId: string | null = null, limit = 100): Promise<{ released: number; cents: number } | null> {
  const { data, error } = await createAdminClient().rpc("release_due_coin_deposits", { p_user: userId, p_limit: limit });
  if (error) {
    if (!MISSING(error.message)) console.error("[coin/deposit] release failed", { code: error.code });
    return null;
  }
  const r = (data ?? {}) as { released?: number; cents?: number };
  return { released: Number(r.released ?? 0), cents: Number(r.cents ?? 0) };
}

export interface CoinReconcileSummary {
  examined: number;
  settled: number;
  pending: number;
  failed: number;
  review: number;
  verificationFailed: number;
  skipped: number;
  released: number;
}

const LEASE_MS = 2 * 60_000;
const RECHECK_MS = 5 * 60_000;

export type CoinAttemptOutcome = "settled" | "pending" | "failed" | "review" | "mismatched" | "verification_failed" | "skipped" | "unsupported";

/**
 * Settle ONE open coin deposit attempt from Flutterwave, the way every server path does (Part 4.1: the cron sweep and the
 * admin recheck share it). The attempt is read from OUR ledger by reference — its member, amount, currency and provider
 * are the row's, never a caller's — and claimed with a lease (a compare-and-set moving updated_at ahead) so a webhook,
 * the return check, the sweep and an admin recheck never work it at once. Settlement stays once per reference in SQL,
 * and the coins still land on hold: nothing here can shorten it. A closed attempt is never re-asked. Never throws.
 */
export async function reconcileCoinDepositAttempt(reference: string): Promise<CoinAttemptOutcome> {
  if (!isCoinDepositReference(reference)) return "unsupported";
  const db = createAdminClient();
  const { data, error } = await db.from("ai_topup_attempts").select(ROW).eq("reference", reference).eq("purpose", "coin_deposit").maybeSingle();
  if (error) return "verification_failed";
  const row = data as AttemptRow | null;
  if (!row) return "unsupported";
  // the row's rail must be the one its reference names (0299: Flutterwave or Paystack) — never guessed
  const provider = coinDepositProviderOf(row.reference);
  if (!provider || row.provider !== provider) return "unsupported";
  if (!(OPEN as readonly string[]).includes(row.status)) return "skipped";
  if (provider === "flutterwave" ? !flutterwaveConfigured(await getFlutterwaveConfig()) : !(await paystackEnabled())) return "skipped";
  if (Date.parse(row.updated_at) > Date.now()) return "skipped";
  const { data: claimed } = await db
    .from("ai_topup_attempts")
    .update({ updated_at: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("reference", row.reference)
    .eq("updated_at", row.updated_at)
    .in("status", [...OPEN])
    .select("reference");
  if (!claimed?.length) return "skipped";
  try {
    const r = await settleCoinDeposit(row.reference, { userId: row.user_id });
    if (r.kind === "credited") return "settled";
    if (r.kind === "pending") return "pending";
    if (r.kind === "failed") return "failed";
    if (r.kind === "mismatch") return "mismatched";
    if (r.kind === "error") return "verification_failed";
    return "review";
  } catch {
    // the provider unreachable: nothing decided, the attempt stays open
    return "verification_failed";
  }
}

/**
 * The scheduled sweep (the ai-reconcile cron): open coin deposit attempts between a minute and seven days old, not asked
 * in the last five minutes, oldest first, claimed with a lease so two workers never ask about one at once; then every due
 * deposit is released. Aggregates only in the result.
 */
export async function reconcileCoinDeposits(opts: { limit?: number; budgetMs?: number } = {}): Promise<CoinReconcileSummary> {
  const out: CoinReconcileSummary = { examined: 0, settled: 0, pending: 0, failed: 0, review: 0, verificationFailed: 0, skipped: 0, released: 0 };
  const now = Date.now();
  const deadline = now + (opts.budgetMs ?? 30_000);
  const db = createAdminClient();
  const { data, error } = await db
    .from("ai_topup_attempts")
    .select(ROW)
    .eq("purpose", "coin_deposit")
    .in("provider", ["flutterwave", "paystack"])
    .in("status", [...OPEN])
    .lte("created_at", new Date(now - 60_000).toISOString())
    .gte("created_at", new Date(now - 7 * 86_400_000).toISOString())
    .lte("updated_at", new Date(now - RECHECK_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(50, opts.limit ?? 10)));
  const rows = error ? [] : ((data ?? []) as AttemptRow[]);
  for (const row of rows) {
    if (Date.now() > deadline) {
      out.skipped += 1;
      continue;
    }
    const r = await reconcileCoinDepositAttempt(row.reference);
    if (r === "skipped" || r === "unsupported") {
      out.skipped += 1;
      continue;
    }
    out.examined += 1;
    if (r === "settled") out.settled += 1;
    else if (r === "pending") out.pending += 1;
    else if (r === "failed") out.failed += 1;
    else if (r === "verification_failed") out.verificationFailed += 1;
    else out.review += 1;
  }
  out.released = (await releaseDueCoinDeposits(null, 200))?.released ?? 0;
  return out;
}

// ── refunds and chargebacks ──────────────────────────────────────────────────

export type CoinReversalOutcome =
  | { ok: true; id: string; state: string; phase: string; due: number; recovered: number; shortfall: number; duplicate: boolean }
  | { ok: false; reason: "not_credited" | "invalid" | "not_paid" | "pending_migration" | "error" };

/** Flutterwave sent something refund-, chargeback- or dispute-shaped about a coin deposit: logged for an admin. */
export async function noteFlutterwaveCoinDepositEvent(type: string, data: Record<string, unknown>): Promise<boolean | null> {
  const tx = (data.transaction ?? null) as Record<string, unknown> | null;
  const ref = [data.tx_ref, data.reference, tx?.tx_ref].find(isCoinDepositReference);
  if (!ref) return null;
  return audit("coin_deposit_provider_event_review", ref, {
    provider: "flutterwave",
    event: type.slice(0, 60),
    provider_id: typeof data.id === "number" || typeof data.id === "string" ? String(data.id).slice(0, 40) : null,
    review: "Check this payment in the Flutterwave dashboard, then record the refund or chargeback for this Frenz Coin deposit.",
  });
}

/** 0299: Paystack sent a refund or dispute about a coin deposit: logged for an admin, who records it after checking. */
export async function notePaystackCoinDepositEvent(type: string, reference: unknown, providerId: unknown): Promise<boolean | null> {
  if (!isPaystackCoinDepositReference(reference)) return null;
  return audit("coin_deposit_provider_event_review", reference, {
    provider: "paystack",
    event: type.slice(0, 60),
    provider_id: typeof providerId === "number" || typeof providerId === "string" ? String(providerId).slice(0, 40) : null,
    review: "Check this payment in the Paystack dashboard, then record the refund or chargeback for this Frenz Coin deposit.",
  });
}

/**
 * An admin records a refund or chargeback of a coin deposit, confirmed in the provider's dashboard (Flutterwave or Paystack). The ORIGINAL charge
 * is re-verified first (ours, and paid); the replay key makes a double press one reversal.
 */
export async function recordAdminCoinDepositReversal(input: { reference: string; kind: "refund" | "dispute"; refundedMinor: number | null; idempotencyKey: string; adminId: string; note: string }): Promise<CoinReversalOutcome> {
  if (!isCoinDepositReference(input.reference) || !KEY.test(input.idempotencyKey)) return { ok: false, reason: "invalid" };
  let paidMinor: number | null;
  let paidCurrency: string | null;
  try {
    const c = coinDepositProviderOf(input.reference) === "paystack" ? await verifyPaystackCoinCharge(input.reference) : await verifyFlutterwaveByReference(input.reference);
    if (c.reference !== input.reference || c.status !== "success") return { ok: false, reason: "not_paid" };
    paidMinor = c.amountMinor;
    paidCurrency = c.currency;
  } catch {
    return { ok: false, reason: "error" };
  }
  if (input.refundedMinor !== null && (!paidMinor || input.refundedMinor > paidMinor)) return { ok: false, reason: "invalid" };
  const { data, error } = await createAdminClient().rpc("reverse_coin_deposit", {
    p_provider: coinDepositProviderOf(input.reference) ?? "flutterwave",
    p_event_key: `admin:${input.idempotencyKey}`,
    p_kind: input.kind,
    p_reference: input.reference,
    p_refunded_minor: input.refundedMinor,
    p_paid_minor: paidMinor,
    p_paid_currency: paidCurrency,
    p_actor: input.adminId,
    p_note: input.note.slice(0, 500),
  });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; id?: string; state?: string; phase?: string; due?: number; recovered?: number; shortfall?: number; duplicate?: boolean };
  if (!r.ok || !r.id) return { ok: false, reason: r.reason === "not_credited" ? "not_credited" : r.reason === "invalid" ? "invalid" : "error" };
  if (Number(r.shortfall ?? 0) > 0 && !r.duplicate) console.error("[coin/reversal] 🔴 a reversed deposit had already been spent or sent — coin transfers and withdrawals paused until an admin settles it (0281: Frenz Coin only)", { reference: input.reference });
  return { ok: true, id: r.id, state: String(r.state), phase: String(r.phase), due: Number(r.due ?? 0), recovered: Number(r.recovered ?? 0), shortfall: Number(r.shortfall ?? 0), duplicate: !!r.duplicate };
}

export async function resolveCoinDepositDispute(id: string, outcome: "won" | "lost", adminId: string, note: string): Promise<{ ok: boolean; reason?: string; state?: string; duplicate?: boolean }> {
  const { data, error } = await createAdminClient().rpc("resolve_coin_deposit_dispute", { p_id: id, p_outcome: outcome, p_actor: adminId, p_note: note.slice(0, 500) });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; state?: string; duplicate?: boolean };
  return { ok: !!r.ok, reason: r.reason, state: r.state, duplicate: !!r.duplicate };
}

/**
 * Closeout (0283): apply a PARTIAL refund that was put in review — its share of the deposit (rounded up), from available
 * coins, the rest a shortfall; once; never while the deposit is on hold. Administrators only (the route checks).
 */
export async function applyCoinDepositPartialRefund(id: string, adminId: string, note: string): Promise<{ ok: boolean; reason?: string; due?: number; recovered?: number; shortfall?: number; duplicate?: boolean }> {
  const { data, error } = await createAdminClient().rpc("apply_coin_deposit_partial_refund", { p_review: id, p_admin: adminId, p_note: note.slice(0, 500) });
  if (error) return { ok: false, reason: MISSING(error.message) || /apply_coin_deposit_partial_refund/.test(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; due?: number; recovered?: number; shortfall?: number; duplicate?: boolean };
  return { ok: !!r.ok, reason: r.reason, due: r.due, recovered: r.recovered, shortfall: r.shortfall, duplicate: !!r.duplicate };
}

export async function clearCoinDepositShortfall(id: string, adminId: string, note: string): Promise<{ ok: boolean; reason?: string; lifted?: boolean }> {
  const { data, error } = await createAdminClient().rpc("clear_coin_deposit_shortfall", { p_id: id, p_actor: adminId, p_note: note.slice(0, 500) });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; lifted?: boolean };
  return { ok: !!r.ok, reason: r.reason, lifted: r.lifted };
}

export interface CoinReversalRow {
  id: string;
  kind: string;
  reference: string;
  userId: string;
  phase: string;
  state: string;
  depositCents: number;
  due: number;
  recovered: number;
  shortfall: number;
  shortfallCleared: boolean;
  createdAt: string;
}

/** For the admin: disputes awaiting an outcome, open shortfalls, partial refunds to review, and recent history. */
export async function listCoinDepositReversals(limit = 100): Promise<{ ok: true; rows: CoinReversalRow[] } | { ok: false; reason: "pending_migration" | "error" }> {
  const { data, error } = await createAdminClient()
    .from("coin_deposit_reversals")
    .select("id, kind, reference, user_id, phase, state, deposit_cents, due_cents, recovered_cents, shortfall_cents, shortfall_cleared_at, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  return {
    ok: true,
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      reference: String(r.reference),
      userId: String(r.user_id),
      phase: String(r.phase),
      state: String(r.state),
      depositCents: Number(r.deposit_cents),
      due: Number(r.due_cents),
      recovered: Number(r.recovered_cents),
      shortfall: Number(r.shortfall_cents),
      shortfallCleared: !!r.shortfall_cleared_at,
      createdAt: String(r.created_at),
    })),
  };
}
