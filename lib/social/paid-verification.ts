import "server-only";

import { resolveCheckoutRate } from "@/lib/ai/character-replace/fx-rate-server";
import { quoteCheckout } from "@/lib/ai/character-replace/topup-fx";
import { getLandingSettings } from "@/lib/landing/settings";
import { initializeVerificationCheckout, paystackFailureIsDefinite, VERIFICATION_PURPOSE, verifyTransaction } from "@/lib/paystack/paystack";
import { SITE_URL } from "@/lib/site";
import { recordVerificationEvent } from "@/lib/social/verification";
import { normalizePaidVerification, PAID_VERIFICATION_KEY, paidVerificationExpiry, type PaidVerificationConfig } from "@/lib/social/paid-verification-config";
import { classifyVerification } from "@/lib/sub/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PAYING FOR THE BLUE TICK (0268, owner 2026-10-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   start    the admin's price, converted to the checkout currency at the live rate (the same quote
 *            subscriptions use), one Paystack checkout with our own reference and purpose;
 *   confirm  ONLY on Paystack's own verified charge (the webhook, or the return page asking with the
 *            reference): success, the currency we asked for, at least the amount we asked for. The
 *            purchase flips initiated → paid in ONE conditional update, so a webhook and a return page
 *            racing can never both grant; the call that wins grants the tick through the audited path
 *            an admin's direct issue uses (an approved request + a verification_events row);
 *   expire   the daily sweep takes back a PAID tick whose period ended without a renewal — never a
 *            tick granted by review or by an admin.
 */

type Row = Record<string, unknown>;
const REF_PREFIX = "frenz_vf_";
const MISSING = (m: string) => /does not exist|could not find|schema cache/i.test(m);

export const isVerificationReference = (r: unknown): r is string => typeof r === "string" && r.startsWith(REF_PREFIX) && r.length <= 100;

export async function getPaidVerificationConfig(): Promise<PaidVerificationConfig> {
  try {
    const { data } = await createAdminClient().from("settings").select("value").eq("key", PAID_VERIFICATION_KEY).maybeSingle();
    return normalizePaidVerification((data as Row | null)?.value);
  } catch {
    return normalizePaidVerification(null);
  }
}

export async function setPaidVerificationConfig(raw: unknown): Promise<PaidVerificationConfig> {
  const cfg = normalizePaidVerification(raw);
  const { error } = await createAdminClient().from("settings").upsert({ key: PAID_VERIFICATION_KEY, value: cfg }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return cfg;
}

/** What the member's page shows: the offer, and their paid tick's end (null = none, or for good). */
export async function paidVerificationOffer(userId: string): Promise<{ config: PaidVerificationConfig; paidUntil: string | null; lifetime: boolean }> {
  const config = await getPaidVerificationConfig();
  try {
    const { data } = await createAdminClient().from("verification_purchases").select("expires_at").eq("user_id", userId).eq("status", "paid").is("expired_at", null).order("paid_at", { ascending: false }).limit(5);
    const rows = (data ?? []) as Row[];
    const lifetime = rows.some((r) => r.expires_at == null);
    const ends = rows.map((r) => r.expires_at as string | null).filter((e): e is string => !!e).sort();
    return { config, paidUntil: ends.at(-1) ?? null, lifetime };
  } catch {
    return { config, paidUntil: null, lifetime: false };
  }
}

type StartResult = { ok: true; url: string; reused: boolean } | { ok: false; error: string; status: number };

export async function startVerificationCheckout(input: { userId: string; email: string }): Promise<StartResult> {
  const cfg = await getPaidVerificationConfig();
  if (!cfg.enabled) return { ok: false, error: "Paid verification isn't available right now.", status: 409 };
  if (!input.email) return { ok: false, error: "Add an email to your account to pay.", status: 400 };
  const db = createAdminClient();
  const { data: prof } = await db.from("profiles").select("is_suspended, is_verified").eq("id", input.userId).maybeSingle();
  if ((prof as Row | null)?.is_suspended) return { ok: false, error: "This account can't be verified.", status: 403 };
  const offer = await paidVerificationOffer(input.userId);
  if (offer.lifetime) return { ok: false, error: "Your verification is already for good.", status: 409 };

  // an open checkout under 30 minutes old is reused: one intent, one payment
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: open, error: openError } = await db.from("verification_purchases").select("checkout_url").eq("user_id", input.userId).eq("status", "initiated").gte("created_at", since).not("checkout_url", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (openError && MISSING(openError.message)) return { ok: false, error: "Paid verification arrives with the next update.", status: 503 };
  if ((open as Row | null)?.checkout_url) return { ok: true, url: (open as Row).checkout_url as string, reused: true };

  const cr = (await getLandingSettings()).frenzAiCharacterReplace;
  const rate = await resolveCheckoutRate(cr, "USD");
  if (rate && "error" in rate) return { ok: false, error: "Payments are unavailable right now. Try again shortly.", status: 503 };
  const q = quoteCheckout({ walletAmountCents: cfg.priceCents, walletCurrency: "USD", checkoutCurrency: cr.recharge.checkoutCurrency, minorPerUsd: rate?.minorPerUsd ?? 0 });
  if ("error" in q) return { ok: false, error: "Payments are unavailable right now. Try again shortly.", status: 503 };

  const reference = `${REF_PREFIX}${crypto.randomUUID().replace(/-/g, "")}`;
  const { error } = await db.from("verification_purchases").insert({ user_id: input.userId, reference, price_cents: cfg.priceCents, charged_currency: q.currency, charged_minor: q.amount, fx_minor_per_usd: q.minorPerUsd || null, period_days: cfg.periodDays });
  if (error) return MISSING(error.message) ? { ok: false, error: "Paid verification arrives with the next update.", status: 503 } : { ok: false, error: "Couldn't start the payment.", status: 500 };
  try {
    const url = await initializeVerificationCheckout({
      email: input.email,
      userId: input.userId,
      amount: q.amount,
      currency: q.currency,
      reference,
      callbackUrl: `${SITE_URL}/account/verification?paid=${encodeURIComponent(reference)}`,
      metadata: { price_cents: cfg.priceCents, period_days: cfg.periodDays },
    });
    await db.from("verification_purchases").update({ checkout_url: url, updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: true, url, reused: false };
  } catch (e) {
    // a definite refusal created nothing; an unknown outcome stays initiated and is settled by its reference later
    if (paystackFailureIsDefinite(e)) await db.from("verification_purchases").update({ status: "failed", failure_source: "initialize_refused", updated_at: new Date().toISOString() }).eq("reference", reference);
    return { ok: false, error: "Couldn't open the payment. Try again.", status: 502 };
  }
}

export type VerificationConfirm = "paid" | "pending" | "failed" | "unknown";

export async function confirmVerificationPayment(reference: string, opts: { userId?: string } = {}): Promise<VerificationConfirm> {
  if (!isVerificationReference(reference)) return "unknown";
  const db = createAdminClient();
  const { data, error } = await db.from("verification_purchases").select("user_id, status, created_at, charged_currency, charged_minor, period_days").eq("reference", reference).maybeSingle();
  if (error) return "pending";
  const row = data as Row | null;
  if (!row) return "unknown";
  // the return page asks for its own member's purchase only
  if (opts.userId && row.user_id !== opts.userId) return "unknown";
  if (row.status === "paid") return "paid";
  if (row.status === "failed" || row.status === "refunded") return "failed";

  let charge;
  try {
    charge = await verifyTransaction(reference);
  } catch {
    return "pending";
  }
  if (charge.metadata?.purpose !== VERIFICATION_PURPOSE || (charge.metadata?.user_id && charge.metadata.user_id !== row.user_id)) return "unknown";
  const outcome = classifyVerification(charge.status, Date.now() - Date.parse(row.created_at as string));
  if (outcome.kind === "pending") return "pending";
  if (outcome.kind === "fail") {
    await db.from("verification_purchases").update({ status: "failed", failure_source: outcome.source, updated_at: new Date().toISOString() }).eq("reference", reference).eq("status", "initiated");
    return "failed";
  }
  // 🔴 Paystack's settled numbers, never ours: the currency asked for, at least the amount asked for
  if ((charge.currency ?? "").toUpperCase() !== String(row.charged_currency).toUpperCase() || !(Number(charge.amount ?? 0) >= Number(row.charged_minor))) {
    await db.from("verification_purchases").update({ status: "failed", failure_source: "amount_mismatch", updated_at: new Date().toISOString() }).eq("reference", reference).eq("status", "initiated");
    console.error("[verification] paid amount does not match the checkout", { reference, amount: charge.amount, currency: charge.currency });
    return "failed";
  }

  const userId = row.user_id as string;
  const offer = await paidVerificationOffer(userId);
  const now = Date.now();
  const expiresAt = paidVerificationExpiry(Number(row.period_days), offer.paidUntil, now);
  // 🔴 ONE winner: only the update that finds the purchase still `initiated` grants
  const { data: won, error: winError } = await db
    .from("verification_purchases")
    .update({ status: "paid", paid_at: new Date(now).toISOString(), expires_at: expiresAt, provider_ref: charge.id ? String(charge.id) : null, updated_at: new Date(now).toISOString() })
    .eq("reference", reference)
    .eq("status", "initiated")
    .select("id");
  if (winError) return "pending";
  if (!won?.length) return "paid";
  await grantPaidTick(userId, reference, expiresAt);
  return "paid";
}

async function grantPaidTick(userId: string, reference: string, expiresAt: string | null): Promise<void> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: prof } = await db.from("profiles").select("is_verified").eq("id", userId).maybeSingle();
  // a renewal of a tick they already hold: the period is extended (above); the record notes it
  if ((prof as Row | null)?.is_verified) {
    const { data: last } = await db.from("verification_requests").select("id").eq("user_id", userId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if ((last as Row | null)?.id) await recordVerificationEvent((last as Row).id as string, userId, "system", "paid_renewal", `${reference}${expiresAt ? ` until ${expiresAt}` : " for good"}`);
    return;
  }
  await db.from("verification_requests").update({ status: "withdrawn", updated_at: now }).eq("user_id", userId).in("status", ["draft", "pending", "in_review"]);
  const { data: req } = await db
    .from("verification_requests")
    .insert({ user_id: userId, status: "approved", category: "other", reviewer_id: null, reviewed_at: now, decision_reason: "Paid verification", issued_directly: true, submitted_at: now })
    .select("id")
    .maybeSingle();
  await db.from("profiles").update({ is_verified: true }).eq("id", userId);
  if ((req as Row | null)?.id) await recordVerificationEvent((req as Row).id as string, userId, "system", "paid", `${reference}${expiresAt ? ` until ${expiresAt}` : " for good"}`);
}

/**
 * The daily sweep (run by /api/cron/profile-snapshots): a PAID tick whose period ended and was not
 * renewed is taken back. Only when the member's current tick is the paid one — a later reviewed
 * approval or an admin's issue keeps it. Bounded; the rest wait for tomorrow.
 */
export async function expirePaidVerifications(limit = 500): Promise<{ expired: number }> {
  const db = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await db.from("verification_purchases").select("id, user_id").eq("status", "paid").is("expired_at", null).not("expires_at", "is", null).lt("expires_at", nowIso).limit(limit);
  if (error || !data?.length) return { expired: 0 };
  let expired = 0;
  for (const p of data as Row[]) {
    const userId = p.user_id as string;
    // still covered by another paid purchase (a renewal, or one for good)?
    const { data: live } = await db.from("verification_purchases").select("id, expires_at").eq("user_id", userId).eq("status", "paid").is("expired_at", null).neq("id", p.id as string);
    const covered = ((live ?? []) as Row[]).some((r) => r.expires_at == null || Date.parse(r.expires_at as string) > Date.now());
    await db.from("verification_purchases").update({ expired_at: nowIso, updated_at: nowIso }).eq("id", p.id as string);
    if (covered) continue;
    const { data: last } = await db.from("verification_requests").select("id, decision_reason").eq("user_id", userId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const current = last as Row | null;
    if (current?.decision_reason !== "Paid verification") continue;
    await db.from("profiles").update({ is_verified: false }).eq("id", userId);
    await db.from("verification_requests").update({ status: "rejected", rejection_code: "expired", decision_reason: "Paid verification ended", updated_at: nowIso }).eq("id", current.id as string);
    await recordVerificationEvent(current.id as string, null, "system", "paid_expired");
    expired++;
  }
  return { expired };
}

/**
 * A refunded or disputed verification charge (the Paystack webhook): the purchase is marked refunded and,
 * unless another paid purchase still covers them, a PAID tick is taken back — the money went back, so the
 * tick does too. A tick granted by review or by an admin is never touched. Idempotent.
 */
export async function reversePaidVerification(reference: string): Promise<"reversed" | "unknown"> {
  if (!isVerificationReference(reference)) return "unknown";
  const db = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data } = await db.from("verification_purchases").select("id, user_id, status").eq("reference", reference).maybeSingle();
  const row = data as Row | null;
  if (!row) return "unknown";
  if (row.status === "refunded") return "reversed";
  // read before the write: whether it had granted a tick is the status it HAD
  const wasPaid = row.status === "paid";
  const userId = row.user_id as string;
  await db.from("verification_purchases").update({ status: "refunded", expired_at: nowIso, updated_at: nowIso }).eq("id", row.id as string);
  if (!wasPaid) return "reversed";
  const { data: live } = await db.from("verification_purchases").select("expires_at").eq("user_id", userId).eq("status", "paid").is("expired_at", null);
  if (((live ?? []) as Row[]).some((r) => r.expires_at == null || Date.parse(r.expires_at as string) > Date.now())) return "reversed";
  const { data: last } = await db.from("verification_requests").select("id, decision_reason").eq("user_id", userId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const current = last as Row | null;
  if (current?.decision_reason === "Paid verification") {
    await db.from("profiles").update({ is_verified: false }).eq("id", userId);
    await db.from("verification_requests").update({ status: "rejected", rejection_code: "refunded", decision_reason: "Paid verification refunded", updated_at: nowIso }).eq("id", current.id as string);
    await recordVerificationEvent(current.id as string, null, "system", "paid_refunded", reference);
  }
  return "reversed";
}
