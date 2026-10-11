import "server-only";

import { after } from "next/server";

import { trackEvent } from "@/lib/analytics/events";
import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import { subscriptionCharge, usd, validatePrice, withdrawalSplit } from "@/lib/creator/membership/engine";
import { getLandingSettings } from "@/lib/landing/settings";
import { initializeSubCheckout, paystackFailureIsDefinite, SUB_PURPOSE, verifyTransaction } from "@/lib/paystack/paystack";
import type { SubConfig } from "@/lib/rewards/config";
import { resolveAccount } from "@/lib/rewards/paystack-banks";
import { payWithdrawalViaPaystack } from "@/lib/rewards/paystack-payouts";
import { validatePayoutDetails } from "@/lib/rewards/withdrawals";
import { SITE_URL } from "@/lib/site";
import { flagsOf, isAccountVisibleTo } from "@/lib/social/account-visibility";
import { createAdminClient } from "@/lib/supabase/admin";

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
}

export async function getSubSettings(creatorId: string): Promise<SubSettings & { ready: boolean }> {
  const db = createAdminClient();
  const base = "sub_price_cents, sub_active, setup_step, setup_completed_at, open, welcome";
  // 0231's column, with the older shape as the answer before that migration runs
  let res = await db.from("creator_membership_settings").select(`${base}, promo_dismissed_at`).eq("creator_id", creatorId).maybeSingle();
  if (res.error && MISSING(res.error.message)) res = (await db.from("creator_membership_settings").select(base).eq("creator_id", creatorId).maybeSingle()) as typeof res;
  const { data, error } = res;
  const r = (data ?? {}) as Row;
  return { priceCents: (r.sub_price_cents as number | null) ?? null, active: !!r.sub_active, setupStep: Number(r.setup_step ?? 0), setupCompleted: !!r.setup_completed_at, open: !!r.open, welcome: (r.welcome as string | null) ?? null, promoDismissed: !!r.promo_dismissed_at, ready: !error };
}

/** Saves setup progress and the price. Completing setup needs a valid price; it never grants payout eligibility. */
export async function saveSubSettings(creatorId: string, patch: { priceCents?: number; step?: number; complete?: boolean; active?: boolean; open?: boolean; welcome?: string | null; dismissPromo?: boolean }): Promise<Result<{ settings: SubSettings }>> {
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
  if (viewerId === creatorId) return true;
  const db = createAdminClient();
  const [{ data, error }, blocked] = await Promise.all([
    db.from("creator_memberships").select("id").eq("creator_id", creatorId).eq("member_id", viewerId).eq("status", "active").eq("billing", "sub").gt("period_end", new Date().toISOString()).limit(1),
    // owner 2026-10-11 ("block or ignore" a subscriber who screenshots): a creator's block ends SUB access at once
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${creatorId},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${creatorId})`).limit(1),
  ]);
  // a failed read is "no access": paid content fails CLOSED
  return !error && !blocked.error && (data ?? []).length > 0 && (blocked.data ?? []).length === 0;
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

/** Opens (or reuses) a Paystack checkout for a subscription. `returnPath` is where the subscriber lands after paying. */
export async function startSubCheckout(input: { subscriberId: string; email: string; creatorId: string; returnPath: string }): Promise<Result<{ url: string; reused: boolean }>> {
  const cfg = await subConfig();
  if (!cfg.purchasesEnabled) return fail("Subscriptions are paused right now.", 503, "paused");
  if (input.subscriberId === input.creatorId) return fail("You don't need to subscribe to yourself.");
  if (!input.email) return fail("Add an email to your account to pay.", 400);
  const db = createAdminClient();
  const [s, creatorR, blockR, memberR] = await Promise.all([
    getSubSettings(input.creatorId),
    db.from("profiles").select("id, handle, is_suspended, is_hidden").eq("id", input.creatorId).maybeSingle(),
    db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${input.subscriberId},blocked_id.eq.${input.creatorId}),and(blocker_id.eq.${input.creatorId},blocked_id.eq.${input.subscriberId})`).limit(1),
    db.from("creator_memberships").select("status").eq("creator_id", input.creatorId).eq("member_id", input.subscriberId).maybeSingle(),
  ]);
  const creator = creatorR.data as Row | null;
  if (!creator || (blockR.data ?? []).length || !isAccountVisibleTo(flagsOf(creator), "stranger")) return fail("You can't subscribe to this creator.", 404);
  if ((memberR.data as Row | null)?.status === "removed") return fail("This creator removed you from their subscribers.", 403);
  if (!s.active || !s.priceCents) return fail("This creator isn't taking subscriptions right now.", 409);
  const price = validatePrice(s.priceCents, cfg);
  if (!price.ok) return fail("This creator's price is outside what Frenz allows. They need to update it.", 409);

  // an open checkout for the same pair, under 30 minutes old, is reused: one intent, one payment
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: open } = await db.from("sub_purchases").select("checkout_url").eq("subscriber_id", input.subscriberId).eq("creator_id", input.creatorId).eq("status", "initiated").gte("created_at", since).not("checkout_url", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if ((open as Row | null)?.checkout_url) return { ok: true, url: (open as Row).checkout_url as string, reused: true };

  const charge = subscriptionCharge(s.priceCents, cfg.purchaseFeePercent);
  const landing = await getLandingSettings();
  const cr = landing.frenzAiCharacterReplace;
  const rate = await resolveCheckoutRate(cr, "USD");
  if (rate && "error" in rate) return fail("Payments are unavailable right now. Try again shortly.", 503);
  const q = quoteCheckout({ walletAmountCents: charge.totalCents, walletCurrency: "USD", checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in q) return fail("Payments are unavailable right now. Try again shortly.", 503);

  const reference = `frenz_sub_${crypto.randomUUID().replace(/-/g, "")}`;
  const { data: row, error } = await db
    .from("sub_purchases")
    .insert({ creator_id: input.creatorId, subscriber_id: input.subscriberId, price_cents: charge.priceCents, fee_cents: charge.feeCents, total_cents: charge.totalCents, fee_bp: charge.feeBp, charged_currency: q.currency, charged_minor: q.amount, fx_minor_per_usd: q.minorPerUsd || null, reference, period_days: cfg.periodDays, hold_days: cfg.holdDays })
    .select("id")
    .single();
  if (error) return MISSING(error.message) ? fail("Subscriptions arrive with the next update.", 503) : fail("Couldn't start the payment.", 500);
  const safeReturn = input.returnPath.startsWith("/") && !input.returnPath.startsWith("//") ? input.returnPath : `/u/${creator.handle as string}`;
  try {
    const url = await initializeSubCheckout({
      email: input.email,
      userId: input.subscriberId,
      amount: q.amount,
      currency: q.currency,
      reference,
      callbackUrl: `${SITE_URL}/sub/return?ref=${encodeURIComponent(reference)}&next=${encodeURIComponent(safeReturn)}`,
      metadata: { purchase_id: (row as Row).id as string, creator_id: input.creatorId, price_cents: charge.priceCents, fee_cents: charge.feeCents, total_cents: charge.totalCents },
    });
    await db.from("sub_purchases").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, url, reused: false };
  } catch (e) {
    // a definite refusal: nothing was created at Paystack, so this purchase can never be paid
    if (paystackFailureIsDefinite(e)) await db.from("sub_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference).eq("status", "initiated");
    return fail("Paystack couldn't open the payment. Try again.", 502);
  }
}

/**
 * Settle from Paystack's OWN record of the charge: the webhook and the return page
 * both call this, and the database answers a repeat with "already done".
 */
export async function confirmSubPayment(reference: string): Promise<{ ok: boolean; status: "paid" | "pending" | "failed" | "mismatch" | "unknown"; next?: string }> {
  if (!reference.startsWith("frenz_sub_")) return { ok: false, status: "unknown" };
  let charge;
  try {
    charge = await verifyTransaction(reference);
  } catch {
    return { ok: false, status: "pending" };
  }
  if (charge.metadata?.purpose !== SUB_PURPOSE) return { ok: false, status: "unknown" };
  if (charge.status !== "success") {
    if (charge.status === "failed" || charge.status === "abandoned" || charge.status === "reversed") {
      await createAdminClient().from("sub_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference).eq("status", "initiated");
      return { ok: false, status: "failed" };
    }
    return { ok: false, status: "pending" };
  }
  const { data, error } = await createAdminClient().rpc("settle_sub_purchase", { p_reference: reference, p_paid_minor: charge.amount ?? 0, p_paid_currency: charge.currency ?? "", p_provider_ref: charge.id ? String(charge.id) : null });
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
  return { ok: false, status: r?.reason === "amount_mismatch" ? "mismatch" : "unknown" };
}

/** A refund, chargeback or admin reversal. */
export async function reverseSub(reference: string, status: "refunded" | "disputed" | "reversed", actorId: string | null, note: string): Promise<Result<{ debtAfter: number }>> {
  const { data, error } = await createAdminClient().rpc("reverse_sub_purchase", { p_reference: reference, p_status: status, p_actor: actorId, p_note: note });
  if (error) return fail("Couldn't reverse it.", 500);
  const r = data as { ok?: boolean; reason?: string; debt_after?: number } | null;
  return r?.ok ? { ok: true, debtAfter: Number(r.debt_after ?? 0) } : fail(r?.reason === "not_found" ? "Not found." : "Couldn't reverse it.", 409, r?.reason);
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

export async function requestSubWithdrawal(input: { userId: string; grossCents: number; details: unknown; idempotencyKey: string }): Promise<Result<{ id: string; status: string; netCents: number; feeCents: number; paidOut: boolean }>> {
  const cfg = await subConfig();
  if (!cfg.withdrawalsEnabled) return fail("SUB withdrawals are paused right now.", 503, "paused");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) return fail("Invalid request.");
  const details = validatePayoutDetails("paystack", input.details);
  if (!details) return fail("Pick your bank and enter a 10-digit account number.");
  const name = await resolveAccount(details.accountNumber, details.bankCode ?? "");
  if (!name) return fail("That account number doesn't match the bank. Check both.");
  details.accountName = name;
  const split = withdrawalSplit(input.grossCents, cfg.withdrawalFeePercent);
  const { data, error } = await createAdminClient().rpc("request_sub_withdrawal", {
    p_user: input.userId,
    p_gross_cents: split.grossCents,
    p_fee_bp: split.feeBp,
    p_min_cents: cfg.minWithdrawalCents,
    p_method: "paystack",
    p_details: details,
    p_snapshot: { withdrawalFeePercent: cfg.withdrawalFeePercent, version: 1 },
    p_idempotency: input.idempotencyKey,
    p_require_qualification: cfg.requireQualification,
  });
  if (error) return MISSING(error.message) ? fail("SUB withdrawals arrive with the next update.", 503) : fail("Couldn't request that withdrawal.", 500);
  const r = data as { ok?: boolean; reason?: string; id?: string; net?: number; fee?: number; duplicate?: boolean; status?: string } | null;
  if (!r?.ok) {
    const msg: Record<string, string> = {
      not_qualified: "Your account isn't approved for withdrawals yet.",
      restricted: "Withdrawals are paused on your account. Contact support.",
      below_minimum: `The minimum withdrawal is ${usd(cfg.minWithdrawalCents)}.`,
      insufficient: "That's more than your available SUB balance.",
      open_exists: "You already have a withdrawal in progress.",
    };
    return fail(msg[r?.reason ?? ""] ?? "Couldn't request that withdrawal.", 409, r?.reason);
  }
  if (r.duplicate) return { ok: true, id: r.id!, status: r.status ?? "pending", netCents: split.netCents, feeCents: split.feeCents, paidOut: false };
  // owner: "withdraw instantly" — straight to Paystack Transfers, no admin step
  let paidOut = false;
  let status = "pending";
  if (cfg.autoPayout) {
    const out = await payWithdrawalViaPaystack(r.id!, null);
    paidOut = out.ok;
    status = out.ok ? (out.status === "success" ? "completed" : "processing") : "pending";
  }
  return { ok: true, id: r.id!, status, netCents: Number(r.net ?? split.netCents), feeCents: Number(r.fee ?? split.feeCents), paidOut };
}
