import "server-only";

import { after } from "next/server";

import { trackEvent } from "@/lib/analytics/events";
import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import { subscriptionCharge, usd, validatePrice, withdrawalSplit } from "@/lib/creator/membership/engine";
import { normalizePaymentRouting, type PaymentMarket } from "@/lib/ai/credits/wallet-config";
import { createFlutterwaveCheckout, flutterwaveFailureIsDefinite, verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { FLUTTERWAVE_CHECKOUT_CURRENCY } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";
import { chargeMatches, type VerifiedCharge } from "@/lib/payments/charge";
import { usableRails } from "@/lib/payments/rails";
import { flutterwaveChargeFor } from "@/lib/payments/flutterwave-charge";
import { isFlutterwaveReference, newFlutterwaveReference } from "@/lib/payments/references";
import { firstRail, routePayment, type RailAttempt } from "@/lib/payments/router";
import { initializeSubCheckout, paystackFailureIsDefinite, paystackRefusedForSure, SUB_PURPOSE, verifyTransaction } from "@/lib/paystack/paystack";
import { withdrawalFlatFeeCents, type SubConfig } from "@/lib/rewards/config";
import { resolveAccount } from "@/lib/rewards/paystack-banks";
import { payWithdrawal } from "@/lib/rewards/flutterwave-payouts";
import { validatePayoutDetails } from "@/lib/rewards/withdrawals";
import { SITE_URL } from "@/lib/site";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { createAdminClient } from "@/lib/supabase/admin";

import { classifyVerification, isSubReference, isUuid, subReturnPath } from "./guards";
import { HOLD_REASON_LABEL, payoutHoldReasons, type PayoutHoldReason } from "./payout-risk";
import { checkoutBlockedByActive, RENEW_WINDOW_DAYS } from "./lifecycle";
import { BUNDLE_MONTHS, isSubMonths, parseBundlePrices, periodDaysFor, promotionEligible, promotionPriceCents, regularPriceFor, subOptions, validateBundlePrice, type BundlePrices, type SubMonths, type SubOption } from "./pricing";
import { activePromotions, promotionCounts, promotionForCheckout } from "./promotions";
import { profilePath } from "@/lib/social/profile-url";

/**
 * SUB — paid subscriptions and SUB withdrawals (owner brief 2026-10-11, 0227).
 *
 * Money in: the subscriber pays the creator's price PLUS the purchase fee, through
 * the existing Paystack checkout, in the market currency at the live rate (the
 * same rate service AI top-ups and ad campaigns use). Access and earnings are
 * granted ONLY by `settle_sub_purchase`, called with Paystack's own verified
 * charge (webhook or the return page re-verifying the reference) — never a
 * browser flag. A short or foreign payment grants nothing and is audited.
 *
 * Money out: `request_sub_withdrawal` checks everything under the balance lock
 * (restriction, minimum, available balance, one open withdrawal, replay key,
 * and the qualification when the admin requires it); the fee is the server's.
 * With `autoPayout` on (owner: "withdraw instantly"), the payout leaves through
 * Paystack Transfers at once; otherwise an admin presses Pay.
 *
 * Nothing here reads or writes the AI credit wallet.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number; reason?: string };
const fail = (error: string, status = 400, reason?: string): { ok: false; error: string; status: number; reason?: string } => ({ ok: false, error, status, reason });

export async function subConfig(): Promise<SubConfig> {
  return (await getLandingSettings()).frenzRewards.sub;
}

// ─── Settings and setup ("Get paid for your content") ────────────────────────

export interface SubSettings {
  priceCents: number | null;
  active: boolean;
  setupStep: number;
  setupCompleted: boolean;
  open: boolean;
  welcome: string | null;
  /** 0231: the creator closed the Get paid card on their profile */
  promoDismissed: boolean;
  /** 0251: how the creator hears about a new subscriber (default both: what is sent today) */
  notifySubscribed: NotifyMode;
  /** 0277: the 3 / 6 / 12-month bundle totals (null = off). The monthly price stays `priceCents`. */
  bundlePrices: BundlePrices;
  /** 0277 has run: bundles and promotions can be saved and sold */
  bundlesReady: boolean;
}

export type NotifyMode = "off" | "push" | "email" | "both";
const NOTIFY_MODES: readonly NotifyMode[] = ["off", "push", "email", "both"];
export const isNotifyMode = (v: unknown): v is NotifyMode => typeof v === "string" && (NOTIFY_MODES as readonly string[]).includes(v);

export async function getSubSettings(creatorId: string): Promise<SubSettings & { ready: boolean }> {
  const db = createAdminClient();
  const base = "sub_price_cents, sub_active, setup_step, setup_completed_at, open, welcome";
  // 0231's, 0251's and 0277's columns, with each older shape as the answer before those migrations run
  let bundlesReady = true;
  let res = await db.from("creator_membership_settings").select(`${base}, promo_dismissed_at, notify_subscribed, bundle_prices`).eq("creator_id", creatorId).maybeSingle();
  if (res.error && MISSING(res.error.message)) {
    bundlesReady = false;
    res = (await db.from("creator_membership_settings").select(`${base}, promo_dismissed_at, notify_subscribed`).eq("creator_id", creatorId).maybeSingle()) as typeof res;
  }
  if (res.error && MISSING(res.error.message)) res = (await db.from("creator_membership_settings").select(`${base}, promo_dismissed_at`).eq("creator_id", creatorId).maybeSingle()) as typeof res;
  if (res.error && MISSING(res.error.message)) res = (await db.from("creator_membership_settings").select(base).eq("creator_id", creatorId).maybeSingle()) as typeof res;
  const { data, error } = res;
  const r = (data ?? {}) as Row;
  return { priceCents: (r.sub_price_cents as number | null) ?? null, active: !!r.sub_active, setupStep: Number(r.setup_step ?? 0), setupCompleted: !!r.setup_completed_at, open: !!r.open, welcome: (r.welcome as string | null) ?? null, promoDismissed: !!r.promo_dismissed_at, notifySubscribed: isNotifyMode(r.notify_subscribed) ? r.notify_subscribed : "both", bundlePrices: parseBundlePrices(r.bundle_prices), bundlesReady: bundlesReady && !error, ready: !error };
}

export type BundlePricesPatch = Partial<Record<"3" | "6" | "12", number | null>>;

/** Saves setup progress and the price. Completing setup needs a valid price; it never grants payout eligibility. */
export async function saveSubSettings(creatorId: string, patch: { priceCents?: number; step?: number; complete?: boolean; active?: boolean; open?: boolean; welcome?: string | null; dismissPromo?: boolean; notifySubscribed?: string; bundlePrices?: BundlePricesPatch }): Promise<Result<{ settings: SubSettings }>> {
  const cfg = await subConfig();
  const db = createAdminClient();
  const current = await getSubSettings(creatorId);
  if (!current.ready) return fail("Creator monetization arrives with the next update.", 503);
  const cols: Row = { creator_id: creatorId, updated_at: new Date().toISOString() };
  if (patch.priceCents !== undefined) {
    const v = validatePrice(patch.priceCents, cfg);
    if (!v.ok) return fail(v.error);
    cols.sub_price_cents = patch.priceCents;
  }
  if (patch.step !== undefined) cols.setup_step = Math.max(0, Math.min(4, Math.floor(patch.step)));
  const price = (cols.sub_price_cents as number | undefined) ?? current.priceCents;
  if (patch.complete) {
    if (!price) return fail("Set your subscription price first.");
    cols.setup_completed_at = new Date().toISOString();
    cols.setup_step = 4;
    cols.sub_active = true;
  }
  if (patch.active !== undefined) {
    if (patch.active && !price) return fail("Set your subscription price first.");
    cols.sub_active = patch.active;
  }
  if (patch.open !== undefined) cols.open = patch.open;
  if (patch.notifySubscribed !== undefined) {
    if (!isNotifyMode(patch.notifySubscribed)) return fail("Choose off, push, email or both.");
    cols.notify_subscribed = patch.notifySubscribed;
  }
  /*
    0277 bundles: only the totals named in the patch change; null turns one off. Each is held to the admin's price
    bounds scaled by its months (pricing.ts validateBundlePrice). Saving a bundle needs the monthly price, which stays
    in sub_price_cents and is never copied here.
  */
  if (patch.bundlePrices !== undefined) {
    if (!current.bundlesReady) return fail("Bundles arrive with the next update.", 503);
    if (!price) return fail("Set your monthly price first.");
    const next: Record<string, number | null> = { "3": current.bundlePrices[3], "6": current.bundlePrices[6], "12": current.bundlePrices[12] };
    for (const m of BUNDLE_MONTHS) {
      const v = patch.bundlePrices[String(m) as "3" | "6" | "12"];
      if (v === undefined) continue;
      if (v !== null) {
        const ok = validateBundlePrice(v, m, cfg);
        if (!ok.ok) return fail(ok.error);
      }
      next[String(m)] = v;
    }
    cols.bundle_prices = next;
  }
  if (patch.dismissPromo !== undefined) cols.promo_dismissed_at = patch.dismissPromo ? new Date().toISOString() : null;
  if (patch.welcome !== undefined) {
    const w = patch.welcome?.trim() || null;
    if (w && (w.length > 400 || /[<>]/.test(w))) return fail("Keep the welcome to 400 characters of plain text.");
    cols.welcome = w;
  }
  const { error } = await db.from("creator_membership_settings").upsert(cols, { onConflict: "creator_id" });
  if (error) return MISSING(error.message) ? fail("Creator monetization arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  // the last step of the /earn funnel — the first completion only, never a re-save
  if (patch.complete && !current.setupCompleted) trackEvent("earn_funnel", { userId: creatorId, metadata: { stage: "completed", signedIn: true } });
  return { ok: true, settings: { ...current, ...(await getSubSettings(creatorId)) } };
}

// ─── Access ──────────────────────────────────────────────────────────────────

/** Is `viewerId` an active, paid-up subscriber of `creatorId`? The creator always has access to their own. */
export async function hasActiveSub(viewerId: string | null, creatorId: string): Promise<boolean> {
  if (!viewerId) return false;
  // both ids are interpolated into a filter string below: anything but a UUID is "no access"
  if (!isUuid(viewerId) || !isUuid(creatorId)) return false;
  if (viewerId === creatorId) return true;
  const db = createAdminClient();
  const [{ data, error }, blocked, people] = await Promise.all([
    db.from("creator_memberships").select("id").eq("creator_id", creatorId).eq("member_id", viewerId).eq("status", "active").eq("billing", "sub").gt("period_end", new Date().toISOString()).limit(1),
    // owner 2026-10-11 ("block or ignore" a subscriber who screenshots): a creator's block ends SUB access at once
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${creatorId},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${creatorId})`).limit(1),
    /*
      Part 8 audit: a SUSPENDED creator or viewer has no access. Suspension is a full lockout
      (lib/social/moderation.ts) enforced per surface; the feed and the profile already hid a
      suspended creator, but opening a post by id, the gallery API, likes, comments and
      announcements all ask only this function — so a suspended creator's private media kept
      being signed for existing subscribers. An admin HIDE is not a suspension and keeps
      existing subscribers' access (Part 4).
    */
    db.from("profiles").select("id, is_suspended").in("id", [creatorId, viewerId]),
  ]);
  // a failed read is "no access": paid content fails CLOSED
  if (error || blocked.error || people.error) return false;
  if (((people.data ?? []) as Row[]).some((p) => p.is_suspended)) return false;
  return (data ?? []).length > 0 && (blocked.data ?? []).length === 0;
}

// ─── Money in ────────────────────────────────────────────────────────────────

export interface SubQuote {
  priceCents: number;
  feeCents: number;
  totalCents: number;
  feePercent: number;
  periodDays: number;
}

/** What a subscriber will pay — the same numbers the checkout charges. */
export async function quoteSub(creatorId: string): Promise<SubQuote | null> {
  const [cfg, s] = await Promise.all([subConfig(), getSubSettings(creatorId)]);
  if (!s.active || !s.priceCents) return null;
  const c = subscriptionCharge(s.priceCents, cfg.purchaseFeePercent);
  return { priceCents: c.priceCents, feeCents: c.feeCents, totalCents: c.totalCents, feePercent: cfg.purchaseFeePercent, periodDays: cfg.periodDays };
}

/**
 * 0277: every duration the creator offers right now — 1 month and each enabled bundle — each with its best eligible
 * promotion, the platform fee on top, the effective monthly price and an honest saving (pricing.ts subOptions). The
 * same numbers startSubCheckout charges. Before 0277 runs: the monthly option alone.
 */
export async function subOffers(creatorId: string, now = Date.now()): Promise<SubOption[]> {
  const [cfg, s] = await Promise.all([subConfig(), getSubSettings(creatorId)]);
  if (!s.active || !s.priceCents) return [];
  const promos = s.bundlesReady ? await activePromotions(creatorId, now) : { rules: [], live: {}, names: {} };
  return subOptions({ monthlyCents: s.priceCents, bundles: s.bundlesReady ? s.bundlePrices : { 3: null, 6: null, 12: null }, periodDays: cfg.periodDays, feePercent: cfg.purchaseFeePercent, promotions: promos.rules, live: promos.live, promotionNames: promos.names, now });
}

/** What one checkout buys: the duration, its access days, the price the creator receives, and the promotion it used. */
interface SubChoice {
  months: SubMonths;
  periodDays: number;
  priceCents: number;
  promotionId: string | null;
}

/**
 * The server's price for the option the member chose — re-read now, never taken from the browser. A promotion must
 * belong to this creator, be inside its window and not paused at server time, cover the duration and still have
 * room (the database checks the room again, atomically, when the purchase row is written).
 */
async function priceChoice(creatorId: string, s: SubSettings, cfg: SubConfig, months: number, promotionId: string | null): Promise<SubChoice | { error: string; status: number }> {
  if (!isSubMonths(months)) return { error: "Choose 1, 3, 6 or 12 months.", status: 400 };
  if ((months !== 1 || promotionId) && !s.bundlesReady) return { error: "Bundles and promotions arrive with the next update.", status: 503 };
  const regular = regularPriceFor(months, s.priceCents, s.bundlePrices);
  if (regular === null) return { error: "This creator doesn't offer that option right now.", status: 409 };
  const periodDays = periodDaysFor(months, cfg.periodDays);
  if (!promotionId) return { months, periodDays, priceCents: regular, promotionId: null };
  const promo = await promotionForCheckout(creatorId, promotionId);
  if (promo === "unavailable") return { error: "Bundles and promotions arrive with the next update.", status: 503 };
  if (!promo) return { error: "This offer isn't available.", status: 409 };
  const live = (await promotionCounts(createAdminClient(), [promo.id]).catch(() => null))?.get(promo.id)?.live;
  if (!promotionEligible(promo, months, Date.now(), live)) return { error: "This offer has ended or is fully redeemed. The regular price is still available.", status: 409 };
  const price = promotionPriceCents(promo, regular);
  if (price === null) return { error: "This offer isn't available.", status: 409 };
  return { months, periodDays, priceCents: price, promotionId: promo.id };
}

/**
 * Opens (or reuses) a checkout for a subscription. `returnPath` is where the subscriber lands after paying.
 * 0277: `months` (1 / 3 / 6 / 12, default 1) and an optional `promotionId` — the browser names an option, the server
 * prices it. Everything stays prepaid: one payment, `periodDays` of access, nothing renews.
 */
export async function startSubCheckout(input: { subscriberId: string; email: string; creatorId: string; returnPath: string; market?: PaymentMarket; country?: string | null; months?: number; promotionId?: string | null; provider?: unknown }): Promise<Result<{ url: string; reused: boolean }>> {
  const cfg = await subConfig();
  if (!cfg.purchasesEnabled) return fail("Subscriptions are paused right now.", 503, "paused");
  if (!isUuid(input.subscriberId) || !isUuid(input.creatorId)) return fail("Invalid request.", 400, "invalid");
  if (input.subscriberId === input.creatorId) return fail("You don't need to subscribe to yourself.");
  if (!input.email) return fail("Add an email to your account to pay.", 400);
  const db = createAdminClient();
  const [s, creatorR, blockR, memberR] = await Promise.all([
    getSubSettings(input.creatorId),
    db.from("profiles").select("id, handle, is_suspended, is_hidden").eq("id", input.creatorId).maybeSingle(),
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${input.subscriberId},blocked_id.eq.${input.creatorId}),and(blocker_id.eq.${input.creatorId},blocked_id.eq.${input.subscriberId})`).limit(1),
    db.from("creator_memberships").select("status, billing, period_end").eq("creator_id", input.creatorId).eq("member_id", input.subscriberId).maybeSingle(),
  ]);
  const creator = creatorR.data as Row | null;
  if (!creator || (blockR.data ?? []).length || !isAccountVisibleTo(flagsOf(creator), "stranger")) return fail("You can't subscribe to this creator.", 404);
  const member = memberR.data as Row | null;
  if (member?.status === "removed") return fail("This creator removed you from their subscribers.", 403);
  /*
    Part 5: no accidental second purchase. A subscriber paid up beyond the last RENEW_WINDOW_DAYS
    would only buy days they already have. Inside the window a renewal extends from the current
    end (settle_sub_purchase, unchanged); after expiry it starts now.
  */
  if (checkoutBlockedByActive(member ? { status: String(member.status ?? ""), billing: String(member.billing ?? ""), periodEnd: (member.period_end as string | null) ?? null } : null, Date.now())) {
    return fail(`You're already subscribed. You can renew in the last ${RENEW_WINDOW_DAYS} days of your access.`, 409, "already_active");
  }
  if (!s.active || !s.priceCents) return fail("This creator isn't taking subscriptions right now.", 409);
  const price = validatePrice(s.priceCents, cfg);
  if (!price.ok) return fail("This creator's price is outside what Frenz allows. They need to update it.", 409);
  const choice = await priceChoice(input.creatorId, s, cfg, input.months ?? 1, input.promotionId ?? null);
  if ("error" in choice) return fail(choice.error, choice.status, "option_unavailable");

  // an open checkout for the same pair AND the same option, under 30 minutes old, is reused: one intent, one payment
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  // a row from before 0277 has no months / promotion: it is a plain month at its own price
  const openQ = (cols: string) => db.from("sub_purchases").select(cols).eq("subscriber_id", input.subscriberId).eq("creator_id", input.creatorId).eq("status", "initiated").gte("created_at", since).not("checkout_url", "is", null).order("created_at", { ascending: false }).limit(10);
  let openR = await openQ("checkout_url, months, promotion_id, price_cents");
  if (openR.error && MISSING(openR.error.message)) openR = await openQ("checkout_url, price_cents");
  const open = ((openR.data ?? []) as unknown as Row[]).find((r) => Number(r.months ?? 1) === choice.months && ((r.promotion_id as string | null | undefined) ?? null) === choice.promotionId && (r.price_cents == null || Number(r.price_cents) === choice.priceCents));
  if (open?.checkout_url) return { ok: true, url: open.checkout_url as string, reused: true };
  // Part 4.2: a Paystack checkout whose creation outcome was unknown is resolved before a new one on EITHER rail
  const held = await resolveHeldPaystackSub(db, input.subscriberId, input.creatorId);
  if (held) return held;

  const charge = subscriptionCharge(choice.priceCents, cfg.purchaseFeePercent);
  const landing = await getLandingSettings();
  const safeReturn = subReturnPath(input.returnPath, `${profilePath(creator.handle as string)}`);
  const pair = { db, input, charge, cfg, safeReturn, choice };

  /*
    ── WHICH RAIL (Part 2) ────────────────────────────────────────────────────
    The router, purpose sub_purchase: Flutterwave first (USD, the exact price —
    only when its account capability is confirmed), then Paystack (NGN at the
    live rate, as before). Paystack is tried only after Flutterwave DEFINITELY
    refused; an unknown outcome ends here and is reconciled.
  */
  const usable = await usableRails("sub_purchase");
  // the member's switch (owner, 2026-10-27: "they can decide to switch") — only reorders what the route allows
  const candidates = routePayment({ purpose: "sub_purchase", market: input.market ?? "other", routing: normalizePaymentRouting(landing.frenzAiPlans?.wallet?.routing, landing.frenzAiPlans?.wallet?.routingVersion), usable, preferred: landing.frenzAiPlans?.wallet?.memberChoice === false ? undefined : input.provider });
  if (!candidates.length) return fail("Payments are unavailable right now. Try again shortly.", 503);
  const out = await firstRail(
    candidates,
    (p) => (p === "flutterwave" ? openFlutterwaveSub(pair) : openPaystackSub(pair, landing)),
    (from, to) => console.warn("[sub] fallback_triggered", { from, to, subscriberId: input.subscriberId }),
  );
  return out.ok ? { ok: true, url: out.value, reused: false } : fail(out.error, out.status);
}

interface SubPair {
  db: ReturnType<typeof createAdminClient>;
  input: { subscriberId: string; email: string; creatorId: string; market?: PaymentMarket; country?: string | null };
  charge: ReturnType<typeof subscriptionCharge>;
  cfg: SubConfig;
  safeReturn: string;
  /** 0277: the duration bought, its access days and the promotion used */
  choice: SubChoice;
}

const BEGIN_REFUSALS: Record<string, string> = {
  promotion_exhausted: "This offer has just been fully redeemed. The regular price is still available.",
  promotion_unavailable: "This offer has ended. The regular price is still available.",
  invalid_duration: "Choose 1, 3, 6 or 12 months.",
};

/**
 * Insert the purchase row FIRST (the immutable record: who, what, how much, which provider) — through
 * begin_sub_purchase (0276), which locks the pair and answers `open` when another request just started one:
 * that one's link is handed back, or the member is told it is being confirmed. Never a second checkout.
 * Before 0276 is applied: the plain insert, as before (no protection against simultaneous requests).
 */
async function insertPurchase(p: SubPair, row: { reference: string; provider: "paystack" | "flutterwave"; currency: string; minor: number; fx: number | null }): Promise<{ id: string } | { stop: RailAttempt<string> }> {
  const args = {
    p_subscriber: p.input.subscriberId, p_creator: p.input.creatorId, p_reference: row.reference, p_provider: row.provider,
    p_price_cents: p.charge.priceCents, p_fee_cents: p.charge.feeCents, p_total_cents: p.charge.totalCents, p_fee_bp: p.charge.feeBp,
    p_charged_currency: row.currency, p_charged_minor: row.minor, p_fx_minor_per_usd: row.fx, p_period_days: p.choice.periodDays, p_hold_days: p.cfg.holdDays,
  };
  const plainMonthly = p.choice.months === 1 && !p.choice.promotionId;
  // 0277's function: the duration and the promotion, with the promotion's limit checked under its own lock
  let begun = await p.db.rpc("begin_sub_purchase", { ...args, p_months: p.choice.months, p_promotion: p.choice.promotionId });
  if (begun.error && MISSING(begun.error.message)) {
    // before 0277: a plain month still sells through 0276's function; a bundle or promotion never does
    if (!plainMonthly) return { stop: { ok: false, refusal: "definite", status: 503, error: "Bundles and promotions arrive with the next update." } };
    begun = await p.db.rpc("begin_sub_purchase", args);
  }
  if (!begun.error) {
    const r = begun.data as { ok?: boolean; id?: string; reason?: string; checkout_url?: string | null } | null;
    if (r?.ok && r.id) return { id: r.id };
    // another request for this pair opened one a moment ago: its link, or "being confirmed" — `unknown` so no other rail is tried
    if (r?.reason === "open" && r.checkout_url) return { stop: { ok: true, value: r.checkout_url } };
    // the promotion ended or filled up between the quote and the insert: nothing was created, no other rail would differ
    if (r?.reason && BEGIN_REFUSALS[r.reason]) return { stop: { ok: false, refusal: "unknown", status: 409, error: BEGIN_REFUSALS[r.reason]! } };
    return { stop: { ok: false, refusal: "unknown", status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." } };
  }
  if (!MISSING(begun.error.message)) return { stop: { ok: false, refusal: "definite", status: 500, error: "Couldn't start the payment." } };
  console.warn("[sub] begin_sub_purchase missing (migration 0276) — plain insert, no simultaneous-request guard");
  const { data, error } = await p.db
    .from("sub_purchases")
    .insert({ creator_id: p.input.creatorId, subscriber_id: p.input.subscriberId, price_cents: p.charge.priceCents, fee_cents: p.charge.feeCents, total_cents: p.charge.totalCents, fee_bp: p.charge.feeBp, charged_currency: row.currency, charged_minor: row.minor, fx_minor_per_usd: row.fx, reference: row.reference, provider: row.provider, period_days: p.choice.periodDays, hold_days: p.cfg.holdDays })
    .select("id")
    .single();
  if (error) return { stop: { ok: false, refusal: "definite", status: MISSING(error.message) ? 503 : 500, error: MISSING(error.message) ? "Subscriptions arrive with the next update." : "Couldn't start the payment." } };
  return { id: (data as Row).id as string };
}

const subCallback = (reference: string, safeReturn: string) => `${SITE_URL}/sub/return?ref=${encodeURIComponent(reference)}&next=${encodeURIComponent(safeReturn)}`;

/** Longer than initialize's 15 s timeout: a younger link-less row may still be mid-request on a parallel tap. */
const HELD_INIT_GRACE_MS = 60_000;

/**
 * Part 4.2 — a Paystack SUB purchase left `initiated` with no link (its initialize timed out or
 * Paystack answered 5xx) may exist at Paystack. Before any new checkout for this pair it is asked
 * about by reference, never retried: paid → settled and the member told; Paystack's own 4xx
 * ("Transaction reference not found", past the grace) → it was never created, closed as
 * init_refused (recoverable: a later verified charge still settles); anything else stays held.
 * The 10-minute reconcile only reads rows WITH a link, so this is where such a row resolves.
 */
async function resolveHeldPaystackSub(db: ReturnType<typeof createAdminClient>, subscriberId: string, creatorId: string): Promise<Result<never> | null> {
  const { data, error } = await db.from("sub_purchases").select("reference, created_at").eq("subscriber_id", subscriberId).eq("creator_id", creatorId).eq("status", "initiated").is("checkout_url", null).order("created_at", { ascending: false }).limit(5);
  if (error) return fail("Payments are unavailable right now. Try again shortly.", 503);
  const stillConfirming = fail("Your last payment is still being confirmed. Try again in a few minutes.", 409);
  for (const h of ((data ?? []) as Row[]).filter((r) => !isFlutterwaveReference(r.reference as string))) {
    const reference = h.reference as string;
    if (!(Date.now() - Date.parse(h.created_at as string) >= HELD_INIT_GRACE_MS)) return stillConfirming;
    try {
      await verifyTransaction(reference);
    } catch (e) {
      if (!paystackRefusedForSure(e)) return stillConfirming;
      await markPurchaseFailed(reference, "init_refused");
      continue;
    }
    const r = await confirmSubPayment(reference).catch(() => null);
    if (r?.status === "paid") return fail("Your payment went through — your subscription is active.", 409);
    if (r?.status !== "failed") return stillConfirming;
  }
  return null;
}

/** The Paystack rail — unchanged in what it charges (NGN at the live rate). */
async function openPaystackSub(p: SubPair, landing: Awaited<ReturnType<typeof getLandingSettings>>): Promise<RailAttempt<string>> {
  const cr = landing.frenzAiCharacterReplace;
  const unavailable: RailAttempt<string> = { ok: false, refusal: "definite", status: 503, error: "Payments are unavailable right now. Try again shortly." };
  const rate = await resolveCheckoutRate(cr, "USD");
  if (rate && "error" in rate) return unavailable;
  // `recharge.checkoutCurrency` is Paystack's checkout currency, never Flutterwave's
  const q = quoteCheckout({ walletAmountCents: p.charge.totalCents, walletCurrency: "USD", checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in q) return unavailable;

  const reference = `frenz_sub_${crypto.randomUUID().replace(/-/g, "")}`;
  const row = await insertPurchase(p, { reference, provider: "paystack", currency: q.currency, minor: q.amount, fx: q.minorPerUsd || null });
  if ("stop" in row) return row.stop;
  try {
    const url = await initializeSubCheckout({
      email: p.input.email,
      userId: p.input.subscriberId,
      amount: q.amount,
      currency: q.currency,
      reference,
      callbackUrl: subCallback(reference, p.safeReturn),
      metadata: { purchase_id: row.id, creator_id: p.input.creatorId, price_cents: p.charge.priceCents, fee_cents: p.charge.feeCents, total_cents: p.charge.totalCents, months: p.choice.months, promotion_id: p.choice.promotionId },
    });
    await p.db.from("sub_purchases").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, value: url };
  } catch (e) {
    // a definite refusal: nothing was created at Paystack, so this purchase can never be paid
    const definite = paystackFailureIsDefinite(e);
    if (definite) await markPurchaseFailed(reference, "init_refused");
    // 503, never 502: Cloudflare replaces an origin 502 with its own HTML page. `refusal`, not the status, decides the fallback
    return { ok: false, refusal: definite ? "definite" : "unknown", status: 503, error: "Paystack couldn't open the payment. Try again." };
  }
}

/** The Flutterwave rail (Part 2): USD, the exact total, no conversion. */
async function openFlutterwaveSub(p: SubPair): Promise<RailAttempt<string>> {
  // a Flutterwave checkout for this pair whose creation outcome was unknown is resolved first — never two at once
  const { data: held } = await p.db.from("sub_purchases").select("reference").eq("subscriber_id", p.input.subscriberId).eq("creator_id", p.input.creatorId).eq("status", "initiated").eq("provider", "flutterwave").is("checkout_url", null).limit(3);
  for (const h of (held ?? []) as Row[]) {
    const r = await confirmSubPayment(h.reference as string).catch(() => null);
    if (r?.status === "paid") return { ok: false, refusal: "unknown", status: 409, error: "Your payment went through — your subscription is active." };
    if (r?.status !== "failed") return { ok: false, refusal: "unknown", status: 409, error: "Your last payment is still being confirmed. Try again in a few minutes." };
  }

  const reference = newFlutterwaveReference("sub_purchase");
  // 2026-10-24: naira in Nigeria (bank transfer, USSD…); 2026-10-26: cedis / shillings / rand in Ghana, Kenya, South Africa; USD elsewhere — the price in USD cents stays on the row
  const fw = await flutterwaveChargeFor(p.charge.totalCents, p.input.market, "sub_purchase", p.input.country);
  const total = fw.amountMinor;
  const row = await insertPurchase(p, { reference, provider: "flutterwave", currency: fw.currency, minor: total, fx: fw.fxMinorPerUsd });
  if ("stop" in row) return row.stop;
  try {
    const url = await createFlutterwaveCheckout({ reference, amountMinor: total, currency: fw.currency, email: p.input.email, redirectUrl: subCallback(reference, p.safeReturn), title: "Frenz subscription", meta: { purchase_id: row.id, months: p.choice.months } });
    await p.db.from("sub_purchases").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, value: url };
  } catch (e) {
    const definite = flutterwaveFailureIsDefinite(e);
    // definite: nothing exists at Flutterwave. Unknown: the row stays `initiated` with no link, resolved by reference before any new checkout
    if (definite) await markPurchaseFailed(reference, "init_refused");
    console.error("[sub] flutterwave initialize failed", { reference, definite, error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, refusal: definite ? "definite" : "unknown", status: 503, error: definite ? "Couldn't open the payment. Try again." : "We couldn't confirm the payment page opened. Try again in a few minutes." };
  }
}

/**
 * Settle from Paystack's OWN record of the charge: the webhook and the return page
 * both call this, and the database answers a repeat with "already done".
 */
/**
 * `held` = Paystack took the money but access was NOT granted because the creator
 * removed this member before the charge settled (0247 `refund_due`): the refund owed is
 * on the financial audit log for an admin.
 */
export type SubConfirmStatus = "paid" | "pending" | "failed" | "mismatch" | "held" | "unknown";

/** Failures that are Paystack's or a refund's final word — never re-asked, never settled (0247). */
const FINAL_FAILURES = new Set(["provider_reversed", "reversal_before_payment"]);

/**
 * Marks an UNSETTLED purchase failed, saying why (0247 `failure_source`). Only ever moves an
 * `initiated` row: a paid, refunded or already-failed purchase is never touched. Before 0247
 * runs the column does not exist, so the status alone is written (the older behaviour).
 */
async function markPurchaseFailed(reference: string, source: "verify_abandoned" | "verify_failed" | "provider_reversed" | "init_refused"): Promise<void> {
  const db = createAdminClient();
  const at = new Date().toISOString();
  const { error } = await db.from("sub_purchases").update({ status: "failed", failure_source: source, updated_at: at }).eq("reference", reference).eq("status", "initiated");
  if (error && MISSING(error.message)) await db.from("sub_purchases").update({ status: "failed", updated_at: at }).eq("reference", reference).eq("status", "initiated");
}

export async function confirmSubPayment(reference: string, opts: { flutterwaveCharge?: VerifiedCharge } = {}): Promise<{ ok: boolean; status: SubConfirmStatus; next?: string }> {
  if (!isSubReference(reference)) return { ok: false, status: "unknown" };
  if (isFlutterwaveReference(reference)) return confirmFlutterwaveSub(reference, opts.flutterwaveCharge);
  const db = createAdminClient();
  /*
    Our own record first (Part 2, 2026-10-16). A reference we never issued costs no Paystack
    call (anyone can type one into /sub/return), a settled one answers from the database, and
    a final state is never re-asked. Only an open or recoverable purchase goes to Paystack.
  */
  let rowR = await db.from("sub_purchases").select("status, created_at, failure_source").eq("reference", reference).maybeSingle();
  if (rowR.error && MISSING(rowR.error.message)) rowR = (await db.from("sub_purchases").select("status, created_at").eq("reference", reference).maybeSingle()) as typeof rowR;
  if (rowR.error) return { ok: false, status: "pending" };
  const row = rowR.data as { status: string; created_at: string; failure_source?: string | null } | null;
  if (!row) return { ok: false, status: "unknown" };
  if (row.status === "paid") return { ok: true, status: "paid" };
  if (row.status === "refund_due") return { ok: false, status: "held" };
  if (row.status === "refunded" || row.status === "disputed" || row.status === "reversed") return { ok: false, status: "failed" };
  if (row.status === "failed" && FINAL_FAILURES.has(row.failure_source ?? "")) return { ok: false, status: "failed" };

  let charge;
  try {
    charge = await verifyTransaction(reference);
  } catch {
    return { ok: false, status: "pending" };
  }
  if (charge.metadata?.purpose !== SUB_PURPOSE) return { ok: false, status: "unknown" };
  /*
    🔴 2026-10-16 (Part 2, audit S1): "abandoned" used to mark the purchase failed at once,
    and the 10-minute reconcile asks about checkouts from 2 minutes old — while a bank-transfer
    or USSD payer was still paying. The charge then completed, settle refused the failed row,
    and the subscriber was charged with no access. Now an unfinished checkout stays open for
    SUB_ABANDON_GRACE_MS, and even after that a verified charge still settles (0247).
  */
  const outcome = classifyVerification(charge.status, Date.now() - Date.parse(row.created_at));
  if (outcome.kind === "pending") return { ok: false, status: "pending" };
  if (outcome.kind === "fail") {
    await markPurchaseFailed(reference, outcome.source);
    return { ok: false, status: "failed" };
  }
  return settleSub(reference, { paidMinor: charge.amount ?? 0, paidCurrency: charge.currency ?? "", providerRef: charge.id ? String(charge.id) : null });
}

/**
 * A Flutterwave SUB purchase (Part 2). Our row first (as above), then Flutterwave's own record of
 * OUR reference — fetched here, or already fetched by the webhook (by transaction id). The amount and
 * currency are checked by `settle_sub_purchase` against the row written before the checkout.
 */
async function confirmFlutterwaveSub(reference: string, given?: VerifiedCharge): Promise<{ ok: boolean; status: SubConfirmStatus; next?: string }> {
  const db = createAdminClient();
  const { data, error } = await db.from("sub_purchases").select("id, status, created_at, failure_source, provider, checkout_url, charged_minor, charged_currency").eq("reference", reference).maybeSingle();
  if (error) return { ok: false, status: "pending" };
  const row = data as { id?: string; status: string; created_at: string; failure_source?: string | null; provider?: string; checkout_url?: string | null; charged_minor?: number | string; charged_currency?: string } | null;
  if (!row || row.provider !== "flutterwave") return { ok: false, status: "unknown" };
  if (row.status === "paid") return { ok: true, status: "paid" };
  if (row.status === "refund_due") return { ok: false, status: "held" };
  if (row.status === "refunded" || row.status === "disputed" || row.status === "reversed") return { ok: false, status: "failed" };
  if (row.status === "failed" && FINAL_FAILURES.has(row.failure_source ?? "")) return { ok: false, status: "failed" };

  let charge: VerifiedCharge;
  try {
    charge = given ?? (await verifyFlutterwaveByReference(reference));
  } catch {
    return { ok: false, status: "pending" };
  }
  if (charge.status !== "not_found" && charge.reference !== reference) return { ok: false, status: "unknown" };
  // a checkout that was never handed out and that Flutterwave does not know: nothing can be paid on it
  if (charge.status === "not_found" && !row.checkout_url) {
    await markPurchaseFailed(reference, "init_refused");
    return { ok: false, status: "failed" };
  }
  // the shared classifier speaks Paystack's words; Flutterwave holding no transaction yet for a handed-out link is an unfinished checkout
  const words = { success: "success", failed: "failed", abandoned: "abandoned", not_found: "abandoned", pending: "pending" } as const;
  const outcome = classifyVerification(words[charge.status], Date.now() - Date.parse(row.created_at));
  if (outcome.kind === "pending") return { ok: false, status: "pending" };
  if (outcome.kind === "fail") {
    await markPurchaseFailed(reference, outcome.source);
    return { ok: false, status: "failed" };
  }
  /*
    🔴 Part 2.1: EXACTLY the amount and currency stored on the purchase (lib/payments/charge.ts). The shared
    settle_sub_purchase accepts "at least" — kept as it is for Paystack — so a Flutterwave over- or underpayment
    is stopped here: nothing settles, the purchase stays open, and the audit log holds it for a person.
  */
  const match = chargeMatches(charge, { provider: "flutterwave", reference, amountMinor: Number(row.charged_minor), currency: String(row.charged_currency ?? "") });
  if (!match.ok) {
    await db.from("financial_audit_log").insert({ action: "sub_payment_mismatch", target_type: "sub_purchase", target_id: row.id ?? null, reference, details: { provider: "flutterwave", mismatch: match.mismatch, paid: charge.amountMinor, currency: charge.currency, expected: Number(row.charged_minor), expected_currency: row.charged_currency ?? null, review: "no access or earnings granted" } });
    console.error("[sub] flutterwave charge does not match the purchase", { reference, mismatch: match.mismatch });
    return { ok: false, status: "mismatch" };
  }
  return settleSub(reference, { paidMinor: charge.amountMinor ?? 0, paidCurrency: charge.currency ?? "", providerRef: charge.externalId });
}

/** The one door into `settle_sub_purchase` for both rails: the SQL checks amount and currency against our row, once. */
async function settleSub(reference: string, paid: { paidMinor: number; paidCurrency: string; providerRef: string | null }): Promise<{ ok: boolean; status: SubConfirmStatus; next?: string }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("settle_sub_purchase", { p_reference: reference, p_paid_minor: paid.paidMinor, p_paid_currency: paid.paidCurrency, p_provider_ref: paid.providerRef });
  if (error) return { ok: false, status: "pending" };
  const r = data as { ok?: boolean; reason?: string; duplicate?: boolean } | null;
  if (r?.ok) {
    // only the call that actually settled it announces it and sweeps it (the other gets duplicate)
    if (!r.duplicate) {
      after(async () => {
        const [{ notifySubscribed }, { autoWithdrawSub }] = await Promise.all([import("./notify"), import("./payout-account")]);
        await notifySubscribed(reference);
        const { data: p } = await createAdminClient().from("sub_purchases").select("creator_id").eq("reference", reference).maybeSingle();
        if (p) await autoWithdrawSub((p as Row).creator_id as string, reference);
      });
    }
    return { ok: true, status: "paid" };
  }
  if (r?.reason === "amount_mismatch") return { ok: false, status: "mismatch" };
  if (r?.reason === "removed") return { ok: false, status: "held" };
  if (r?.reason === "not_payable") return { ok: false, status: "failed" };
  return { ok: false, status: "unknown" };
}

/**
 * Purchases still `initiated` — re-asked of Paystack (owner, 2026-10-12: "after paying it
 * still shows these posts are for paid subscribers… and the balance wasn't added").
 *
 * A paid charge settles from two places, and BOTH can miss: the webhook may never be
 * delivered, and the return page used to demand a sign-in before confirming — but
 * Paystack sends the payer back in the BROWSER, where an installed-app member is
 * usually signed out, so they met a login page and the payment was never confirmed.
 * This runs every 10 minutes inside the existing ai-reconcile invocation (no new
 * cron), bounded, and only touches rows Paystack has an answer for. One indexed read
 * when nothing is pending. Settling is idempotent in SQL, so a race with a late
 * webhook only ever answers "duplicate".
 */
export async function reconcilePendingSubPurchases(limit = 20): Promise<{ checked: number; paid: number; failed: number }> {
  const out = { checked: 0, paid: 0, failed: 0 };
  const now = Date.now();
  const { data, error } = await createAdminClient()
    .from("sub_purchases")
    .select("reference")
    .eq("status", "initiated")
    .not("checkout_url", "is", null)
    // a checkout younger than 2 minutes may still be on Paystack's page; older than 2 days is abandoned
    .lte("created_at", new Date(now - 2 * 60_000).toISOString())
    .gte("created_at", new Date(now - 2 * 86_400_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data?.length) return out;
  for (const row of data as { reference: string }[]) {
    out.checked += 1;
    const r = await confirmSubPayment(row.reference).catch(() => null);
    if (r?.status === "paid") out.paid += 1;
    else if (r?.status === "failed") out.failed += 1;
  }
  return out;
}

/** The viewer's own unsettled purchase for this creator, confirmed now (the SUB tab heals itself on view). */
export async function settleOwnPendingSub(subscriberId: string, creatorId: string): Promise<boolean> {
  if (!isUuid(subscriberId) || !isUuid(creatorId)) return false;
  const { data } = await createAdminClient()
    .from("sub_purchases")
    .select("reference")
    .eq("subscriber_id", subscriberId)
    .eq("creator_id", creatorId)
    .eq("status", "initiated")
    .not("checkout_url", "is", null)
    .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ref = (data as { reference?: string } | null)?.reference;
  if (!ref) return false;
  return (await confirmSubPayment(ref).catch(() => null))?.status === "paid";
}

/** A refund, chargeback or admin reversal. */
export async function reverseSub(reference: string, status: "refunded" | "disputed" | "reversed", actorId: string | null, note: string): Promise<Result<{ debtAfter: number }>> {
  const { data, error } = await createAdminClient().rpc("reverse_sub_purchase", { p_reference: reference, p_status: status, p_actor: actorId, p_note: note });
  if (error) return fail("Couldn't reverse it.", 500);
  const r = data as { ok?: boolean; reason?: string; debt_after?: number } | null;
  return r?.ok ? { ok: true, debtAfter: Number(r.debt_after ?? 0) } : fail(r?.reason === "not_found" ? "Not found." : "Couldn't reverse it.", 409, r?.reason);
}

/**
 * A Paystack `refund.processed` on a SUB charge (Part 12 financial audit).
 *
 * 🔴 A PARTIAL refund used to be applied as a full reversal: the whole earning was clawed back
 * and the subscriber lost the access they still paid most of. The ledger has no partial clawback,
 * so the honest, smallest answer is: only a refund of the WHOLE charge (same currency, at least the
 * charged amount) reverses the purchase. A smaller one, or one in another currency, changes no
 * balance and no access — it goes on the financial audit log for an admin to settle by hand.
 * A payload with no amount (older events) keeps the old meaning: a full refund.
 */
export async function reverseSubForRefund(reference: string, refunded: { minor?: unknown; currency?: unknown }): Promise<Result<{ debtAfter: number; review?: true }>> {
  const minor = typeof refunded.minor === "number" && Number.isInteger(refunded.minor) && refunded.minor > 0 ? refunded.minor : null;
  if (minor === null) return reverseSub(reference, "refunded", null, "Paystack refund.processed");
  const db = createAdminClient();
  const { data, error } = await db.from("sub_purchases").select("id, charged_minor, charged_currency").eq("reference", reference).maybeSingle();
  if (error) return fail("Couldn't read the purchase.", 500);
  const p = data as { id: string; charged_minor: number; charged_currency: string } | null;
  // an unknown reference: the SQL answers not_found, exactly as before
  if (!p) return reverseSub(reference, "refunded", null, "Paystack refund.processed");
  const currency = typeof refunded.currency === "string" ? refunded.currency.toUpperCase() : p.charged_currency;
  const full = currency === p.charged_currency && minor >= Number(p.charged_minor);
  if (full) return reverseSub(reference, "refunded", null, "Paystack refund.processed");
  const action = currency === p.charged_currency ? "sub_partial_refund" : "sub_refund_unrecognised";
  const { error: aErr } = await db.from("financial_audit_log").insert({
    action,
    target_type: "sub_purchase",
    target_id: p.id,
    reference,
    details: { refunded_minor: minor, currency, charged_minor: Number(p.charged_minor), charged_currency: p.charged_currency, review: "no balance or access was changed" },
  });
  if (aErr) return fail("Couldn't record the refund.", 500);
  return { ok: true, debtAfter: 0, review: true };
}

/**
 * A dispute the platform WON (Part 12 follow-up, 0254). This integration receives no provider event
 * for a dispute's outcome (only charge.dispute.create), so an ADMIN confirms it in the Paystack
 * dashboard and calls this. Once only: the earning comes back (any debt first), the access the
 * payment bought comes back up to its own period end, and both are audited with the admin's id.
 */
export async function restoreDisputedSub(reference: string, adminId: string, note: string): Promise<Result<{ duplicate: boolean }>> {
  const { data, error } = await createAdminClient().rpc("restore_disputed_sub_purchase", { p_reference: reference, p_actor: adminId, p_note: note });
  if (error) return /restore_disputed_sub_purchase|function|schema cache/i.test(error.message) ? fail("Dispute recovery arrives with migration 0254.", 503, "pending_migration") : fail("Couldn't restore it.", 500);
  const r = data as { ok?: boolean; reason?: string; duplicate?: boolean } | null;
  if (r?.ok) return { ok: true, duplicate: !!r.duplicate };
  return fail(r?.reason === "not_disputed" ? "Only a purchase reversed as disputed can be restored." : r?.reason === "nothing_clawed_back" ? "This dispute never took an earning back (the payment was already owed as a refund), so there is nothing to restore." : r?.reason === "not_found" ? "Not found." : "Couldn't restore it.", 409, r?.reason);
}

// ─── Earnings ────────────────────────────────────────────────────────────────

export interface SubEarnings {
  pendingCents: number;
  availableCents: number;
  heldCents: number;
  debtCents: number;
  lifetimeCents: number;
  withdrawnCents: number;
  activeSubscribers: number;
  ledger: { kind: string; amountCents: number; note: string | null; at: string }[];
  withdrawals: { id: string; status: string; grossCents: number; feeCents: number; netCents: number; at: string; reference: string | null }[];
  ready: boolean;
}

export async function subEarnings(creatorId: string): Promise<SubEarnings> {
  const db = createAdminClient();
  const release = await db.rpc("release_sub_earnings", { p_creator: creatorId });
  const [b, l, w, subs] = await Promise.all([
    db.from("sub_balances").select("*").eq("creator_id", creatorId).maybeSingle(),
    db.from("sub_ledger").select("kind, amount_cents, note, created_at").eq("creator_id", creatorId).order("created_at", { ascending: false }).limit(40),
    db.from("withdrawal_requests").select("id, status, gross_cents, fee_cents, net_cents, created_at, payout_reference").eq("user_id", creatorId).eq("source", "sub").order("created_at", { ascending: false }).limit(20),
    db.from("creator_memberships").select("id", { count: "exact", head: true }).eq("creator_id", creatorId).eq("billing", "sub").eq("status", "active").gt("period_end", new Date().toISOString()),
  ]);
  const r = (b.data ?? {}) as Row;
  return {
    pendingCents: Number(r.pending_cents ?? 0),
    availableCents: Number(r.available_cents ?? 0),
    heldCents: Number(r.held_cents ?? 0),
    debtCents: Number(r.debt_cents ?? 0),
    lifetimeCents: Number(r.lifetime_cents ?? 0),
    withdrawnCents: Number(r.withdrawn_cents ?? 0),
    activeSubscribers: subs.error ? 0 : (subs.count ?? 0),
    ledger: ((l.data ?? []) as Row[]).map((x) => ({ kind: x.kind as string, amountCents: Number(x.amount_cents), note: (x.note as string | null) ?? null, at: x.created_at as string })),
    withdrawals: ((w.data ?? []) as Row[]).map((x) => ({ id: x.id as string, status: x.status as string, grossCents: Number(x.gross_cents ?? 0), feeCents: Number(x.fee_cents ?? 0), netCents: Number(x.net_cents ?? 0), at: x.created_at as string, reference: (x.payout_reference as string | null) ?? null })),
    ready: !release.error && !b.error,
  };
}

// ─── Money out ───────────────────────────────────────────────────────────────

export async function requestSubWithdrawal(input: { userId: string; grossCents: number; details: unknown; idempotencyKey: string; method?: "paystack" | "international" }): Promise<Result<{ id: string; status: string; netCents: number; feeCents: number; paidOut: boolean }>> {
  const cfg = await subConfig();
  if (!cfg.withdrawalsEnabled) return fail("Private post withdrawals are paused right now.", 503, "paused");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) return fail("Invalid request.");
  /*
    🔴 Part 13: a SUSPENDED account moves no money out. With autoPayout on, a request goes straight to
    a Paystack transfer below — so a creator suspended for fraud could empty the balance before the
    chargebacks land, by hand (/api/sub/withdraw) or through the auto-withdrawal sweep (both come
    here). Read on every request (a suspension applies at once) and fail CLOSED: no profile, or a
    failed read, sends nothing.
  */
  const { data: who, error: whoError } = await createAdminClient().from("profiles").select("is_suspended").eq("id", input.userId).maybeSingle();
  if (whoError || !who) return fail("Couldn't request that withdrawal. Try again shortly.", 503, "unavailable");
  if ((who as Row).is_suspended) return fail("Withdrawals are paused on your account. Contact support.", 403, "suspended");
  // owner 2026-10-12: outside Nigeria → a bank wire or PayPal, paid by hand from the admin queue (never Paystack)
  const method = input.method === "international" ? "international" : "paystack";
  const details = validatePayoutDetails(method, input.details);
  if (!details) return fail(method === "international" ? "Check your payout details: country (not Nigeria), name, and the bank with its SWIFT code, or your PayPal email." : "Pick your bank and enter a 10-digit account number.");
  if (method === "paystack") {
    const name = await resolveAccount(details.accountNumber, details.bankCode ?? "");
    if (!name) return fail("That account number doesn't match the bank. Check both.");
    details.accountName = name;
  }
  const split = withdrawalSplit(input.grossCents, cfg.withdrawalFeePercent);
  // 0258 (owner 2026-10-17): a flat fee ON TOP of the amount, by tier; the balance must cover both
  const flatFeeCents = withdrawalFlatFeeCents(split.grossCents, cfg.flatFees);
  const args = {
    p_user: input.userId,
    p_gross_cents: split.grossCents,
    p_fee_bp: split.feeBp,
    p_min_cents: cfg.minWithdrawalCents,
    p_method: method,
    p_details: details,
    p_snapshot: { withdrawalFeePercent: cfg.withdrawalFeePercent, flatFeeCents, version: 2 },
    p_idempotency: input.idempotencyKey,
    p_require_qualification: cfg.requireQualification,
  };
  let { data, error } = await createAdminClient().rpc("request_sub_withdrawal", { ...args, p_flat_fee_cents: flatFeeCents });
  if (error && /p_flat_fee_cents|request_sub_withdrawal|schema cache/i.test(error.message)) {
    // before 0258 runs the function has no flat-fee argument: withdrawals keep working without it
    console.warn("[sub/withdraw] flat fee not applied: migration 0258 not run yet", { userId: input.userId });
    ({ data, error } = await createAdminClient().rpc("request_sub_withdrawal", args));
  }
  if (error) return MISSING(error.message) ? fail("Private post withdrawals arrive with the next update.", 503) : fail("Couldn't request that withdrawal.", 500);
  const r = data as { ok?: boolean; reason?: string; id?: string; net?: number; fee?: number; flat_fee?: number; duplicate?: boolean; status?: string } | null;
  if (!r?.ok) {
    const msg: Record<string, string> = {
      not_qualified: "Your account isn't approved for withdrawals yet.",
      restricted: "Withdrawals are paused on your account. Contact support.",
      below_minimum: `The minimum withdrawal is ${usd(cfg.minWithdrawalCents)}.`,
      insufficient: `That's more than your available private post balance (the amount plus the ${usd(flatFeeCents)} withdrawal fee).`,
      open_exists: "You already have a withdrawal in progress.",
    };
    return fail(msg[r?.reason ?? ""] ?? "Couldn't request that withdrawal.", 409, r?.reason);
  }
  if (r.duplicate) return { ok: true, id: r.id!, status: r.status ?? "pending", netCents: split.netCents, feeCents: split.feeCents, paidOut: false };
  /*
    owner: "withdraw instantly" — through the admin's payout route (Flutterwave only by default; Paystack only on the
    route that names it — lib/rewards/payout-rail.ts), no admin step — but ONLY past the fraud gates (2026-10-24, lib/sub/payout-risk.ts):
    a new bank account, a large or fast-repeating amount, a bank account shared with another creator or an unconfirmed
    email keeps it PENDING for an admin, with the reasons on the financial audit log. It is never refused for it.
  */
  let paidOut = false;
  let status = "pending";
  // only a Nigerian bank withdrawal can leave automatically; international ones wait for the team
  if (cfg.autoPayout && method === "paystack") {
    const hold = await payoutHolds(input.userId, r.id!, split.grossCents, details, cfg);
    if (hold.length) {
      await createAdminClient().from("financial_audit_log").insert({ actor_id: null, action: "withdrawal_held_for_review", target_type: "withdrawal", target_id: r.id!, reference: null, details: { reasons: hold, labels: hold.map((h) => HOLD_REASON_LABEL[h]), gross_cents: split.grossCents } });
      console.warn("[sub/withdraw] held for review", { userId: input.userId, id: r.id, reasons: hold });
    } else {
      const out = await payWithdrawal(r.id!, null);
      paidOut = out.ok;
      status = out.ok ? (out.status === "success" || out.status === "successful" ? "completed" : "processing") : "pending";
      // the chosen provider refused (no silent second rail since 2026-10-29): the money stays held for an admin, who sees why
      if (!out.ok) {
        await createAdminClient()
          .from("financial_audit_log")
          .insert({ actor_id: null, action: "withdrawal_payout_refused", target_type: "withdrawal", target_id: r.id!, reference: null, details: { error: out.error.slice(0, 300), gross_cents: split.grossCents } })
          .then(
            () => undefined,
            () => undefined,
          );
        console.warn("[sub/withdraw] instant payout refused", { userId: input.userId, id: r.id, error: out.error });
      }
    }
  }
  return { ok: true, id: r.id!, status, netCents: Number(r.net ?? split.netCents), feeCents: Number(r.fee ?? split.feeCents), paidOut };
}

/**
 * The facts the instant-payout gate needs, read fresh. Any read that fails answers "unknown", which HOLDS the payout
 * (fail closed). The withdrawal itself already exists and its money is held either way.
 */
async function payoutHolds(userId: string, withdrawalId: string, grossCents: number, details: { bankCode?: string; accountNumber?: string }, cfg: SubConfig): Promise<PayoutHoldReason[]> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [acct, recent, shared, who] = await Promise.all([
    db.from("sub_payout_accounts").select("bank_code, account_number, verified_at").eq("creator_id", userId).maybeSingle(),
    db.from("withdrawal_requests").select("id, gross_cents, status").eq("user_id", userId).eq("source", "sub").gte("created_at", since).in("status", ["approved", "processing", "completed"]).limit(100),
    details.accountNumber && details.bankCode ? db.from("sub_payout_accounts").select("creator_id").eq("account_number", details.accountNumber).eq("bank_code", details.bankCode).neq("creator_id", userId).limit(1) : Promise.resolve({ data: [], error: null }),
    (async () => db.auth.admin.getUserById(userId))().catch(() => ({ data: { user: null }, error: new Error("auth") })),
  ]);
  const a = acct.data as { bank_code?: string; account_number?: string; verified_at?: string | null } | null;
  // the request must be to the SAVED, verified account; inline details for a different account count as new
  const saved = !acct.error && a && a.bank_code === details.bankCode && a.account_number === details.accountNumber ? (a.verified_at ?? null) : null;
  const last24h = recent.error ? null : ((recent.data ?? []) as Row[]).filter((w) => w.id !== withdrawalId).reduce((t, w) => t + Number(w.gross_cents ?? 0), 0);
  const user = (who as { data?: { user?: { email_confirmed_at?: string | null } | null }; error?: unknown }).data?.user;
  return payoutHoldReasons(
    { amountCents: grossCents, accountVerifiedAt: saved, last24hCents: last24h, sharedAccount: shared.error ? null : (shared.data ?? []).length > 0, emailConfirmed: (who as { error?: unknown }).error || !user ? null : !!user.email_confirmed_at },
    cfg,
    Date.now(),
  );
}
