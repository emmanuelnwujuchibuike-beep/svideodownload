import "server-only";

import { verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { flutterwaveReferencePurpose } from "@/lib/payments/references";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, verifyTransaction } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A WALLET TOP-UP WAS REFUNDED OR CHARGED BACK (Frenz Coin Part 2, H1 — 0278)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Since 0202 a paid deposit lands as WITHDRAWABLE credits, so a top-up whose money went back to the payer must take
 * its credits back too — or they can be sent on and cashed out. `reverse_wallet_topup` (SQL) does the accounting:
 * once per provider event, never more than the top-up credited in total, only what is still in the wallet. What was
 * already spent or sent is a SHORTFALL: recorded, AI-credit transfers and withdrawals paused (0281: by the shortfall row, not an account restriction), an admin settles it. A balance never goes
 * negative and no ledger row is rewritten.
 *
 * ── What is believed, per provider ──────────────────────────────────────────
 *
 *   Paystack     `refund.processed` and `charge.dispute.create` arrive signed (HMAC over the raw body). The ORIGINAL
 *                charge is re-verified with /transaction/verify by our reference: it must be ours, a wallet top-up,
 *                and have actually been paid (`success`, or `reversed` once refunded). The refunded amount is the
 *                event's, in the charge's currency — another currency changes nothing and goes to review. A dispute
 *                HOLDS the credits; its outcome is recorded by an admin after checking the dashboard (Paystack's
 *                `charge.dispute.resolve` wording is not relied on — it is logged for review).
 *   Flutterwave  this integration subscribes to no documented refund or chargeback event. Anything that looks like
 *                one is logged for review, and an admin records the reversal here after the original charge is
 *                re-verified by reference (lib/ai/wallet/topup-reversals.ts recordAdminTopupReversal).
 *
 * A provider that cannot be reached is NOT an answer: the webhook answers 500 and the delivery is retried.
 */

export type ReversalKind = "refund" | "dispute";
export type ReversalProvider = "paystack" | "flutterwave";

/** Our Paystack wallet top-up reference (`frenz_cr_topup_<uuid>`), never the Flutterwave one (`frenz_cr_topup_fw_…`). */
const PAYSTACK_TOPUP_REF = new RegExp(`^${CHARACTER_REPLACE_TOPUP_PURPOSE}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);
export const isPaystackTopupReference = (r: unknown): r is string => typeof r === "string" && PAYSTACK_TOPUP_REF.test(r);
export const isFlutterwaveTopupReference = (r: unknown): r is string => flutterwaveReferencePurpose(r) === "wallet_topup";
export const topupProvider = (r: unknown): ReversalProvider | null => (isFlutterwaveTopupReference(r) ? "flutterwave" : isPaystackTopupReference(r) ? "paystack" : null);

export type ReversalOutcome =
  | { ok: true; id: string; state: string; due: number; recovered: number; shortfall: number; duplicate: boolean }
  | { ok: false; reason: "not_credited" | "invalid" | "not_paid" | "currency" | "pending_migration" | "error" };

const MISSING = (m: string) => /reverse_wallet_topup|resolve_wallet_topup_dispute|clear_wallet_topup_shortfall|wallet_topup_reversals|schema cache|does not exist/i.test(m);

/** The SQL call, and nothing else: callers verify with the provider first. */
export async function reverseWalletTopup(input: { provider: ReversalProvider; eventKey: string; kind: ReversalKind; reference: string; refundedMinor: number | null; paidMinor: number | null; paidCurrency: string | null; actorId: string | null; note: string | null }): Promise<ReversalOutcome> {
  const { data, error } = await createAdminClient().rpc("reverse_wallet_topup", {
    p_provider: input.provider,
    p_event_key: input.eventKey.slice(0, 200),
    p_kind: input.kind,
    p_reference: input.reference,
    p_refunded_minor: input.refundedMinor,
    p_paid_minor: input.paidMinor,
    p_paid_currency: input.paidCurrency,
    p_actor: input.actorId,
    p_note: input.note?.slice(0, 500) ?? null,
  });
  if (error) {
    if (MISSING(error.message)) return { ok: false, reason: "pending_migration" };
    console.error("[wallet/reversal] reverse_wallet_topup failed", { reference: input.reference, code: error.code });
    return { ok: false, reason: "error" };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; id?: string; state?: string; due?: number; recovered?: number; shortfall?: number; duplicate?: boolean };
  if (!r.ok || !r.id) return { ok: false, reason: r.reason === "not_credited" ? "not_credited" : r.reason === "invalid" ? "invalid" : "error" };
  if (Number(r.shortfall ?? 0) > 0 && !r.duplicate) console.error("[wallet/reversal] 🔴 a reversed top-up had already been spent or sent — AI-credit transfers and withdrawals paused until an admin settles it (0281: AI credits only)", { reference: input.reference, shortfall: r.shortfall });
  return { ok: true, id: r.id, state: String(r.state), due: Number(r.due ?? 0), recovered: Number(r.recovered ?? 0), shortfall: Number(r.shortfall ?? 0), duplicate: !!r.duplicate };
}

const minor = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);

async function review(action: string, reference: string, details: Record<string, unknown>): Promise<boolean> {
  const { error } = await createAdminClient().from("financial_audit_log").insert({ action, target_type: "wallet_topup", target_id: reference, reference, details });
  return !error;
}

/**
 * A signed Paystack refund / dispute event naming one of our wallet top-ups. `null` = not a wallet top-up (the caller
 * carries on with its other branches). `{ retry: true }` = ask Paystack to redeliver (unreachable, a database error).
 */
export async function handlePaystackTopupReversal(event: string, data: Record<string, unknown>): Promise<null | { retry: boolean; outcome: string }> {
  const tx = (data.transaction ?? null) as Record<string, unknown> | null;
  const ref = [data.transaction_reference, tx?.reference, data.reference].find(isPaystackTopupReference);
  if (!ref) return null;
  const eventId = typeof data.id === "number" || typeof data.id === "string" ? String(data.id) : null;

  if (event === "charge.dispute.resolve" || event === "charge.dispute.remind") {
    // the outcome is decided by an admin after checking the dashboard: this is a nudge, logged once per delivery shape
    return (await review("wallet_topup_dispute_event", ref, { event, dispute_id: eventId, resolution: typeof data.resolution === "string" ? data.resolution.slice(0, 40) : null, status: typeof data.status === "string" ? data.status.slice(0, 40) : null })) ? { retry: false, outcome: "review" } : { retry: true, outcome: "audit_failed" };
  }
  const kind: ReversalKind | null = event === "refund.processed" ? "refund" : event === "charge.dispute.create" ? "dispute" : null;
  if (!kind) return null;

  // 🔴 the ORIGINAL charge, from Paystack, by our reference — never the event body alone
  let paid: { status?: string; amount?: number; currency?: string; reference?: string };
  try {
    paid = await verifyTransaction(ref);
  } catch {
    return { retry: true, outcome: "verify_unavailable" };
  }
  const paidMinor = minor(paid.amount);
  const paidCurrency = typeof paid.currency === "string" ? paid.currency.toUpperCase() : null;
  if (paid.reference !== ref || !paidMinor || !paidCurrency || !["success", "reversed"].includes(String(paid.status))) {
    return (await review("wallet_topup_reversal_unverified", ref, { event, provider_status: String(paid.status ?? "none").slice(0, 40), review: "Paystack does not show this top-up as paid. Nothing was changed." })) ? { retry: false, outcome: "unverified" } : { retry: true, outcome: "audit_failed" };
  }
  // a refund names its amount, a dispute its refund_amount; a missing one is the whole charge (the older payloads)
  const refunded = minor(kind === "refund" ? data.amount : (data.refund_amount ?? data.amount));
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : paidCurrency;
  if (currency !== paidCurrency) {
    return (await review("wallet_topup_refund_unrecognised", ref, { event, currency, paid_currency: paidCurrency, refunded_minor: refunded, review: "a refund in another currency changes no balance" })) ? { retry: false, outcome: "currency_review" } : { retry: true, outcome: "audit_failed" };
  }
  const out = await reverseWalletTopup({
    provider: "paystack",
    // a stable key per provider event: Paystack's own id when it sends one, else the reference (one refund per charge)
    eventKey: `${kind}:${eventId ?? ref}`,
    kind,
    reference: ref,
    refundedMinor: refunded,
    paidMinor,
    paidCurrency,
    actorId: null,
    note: `Paystack ${event}`,
  });
  if (out.ok) return { retry: false, outcome: `${kind}:${out.state}${out.shortfall > 0 ? ":shortfall" : ""}${out.duplicate ? ":duplicate" : ""}` };
  if (out.reason === "not_credited") return { retry: false, outcome: "not_credited" };
  // the migration not run yet, or a database error: ask again rather than drop a chargeback on the floor
  return { retry: true, outcome: out.reason };
}

/** Flutterwave sent something refund- or chargeback-shaped about one of our top-ups: logged for an admin (no documented contract). */
export async function noteFlutterwaveTopupEvent(type: string, data: Record<string, unknown>): Promise<boolean | null> {
  const tx = (data.transaction ?? null) as Record<string, unknown> | null;
  const ref = [data.tx_ref, data.reference, tx?.tx_ref].find(isFlutterwaveTopupReference);
  if (!ref) return null;
  return review("wallet_topup_provider_event_review", ref, {
    provider: "flutterwave",
    event: type.slice(0, 60),
    provider_id: typeof data.id === "number" || typeof data.id === "string" ? String(data.id).slice(0, 40) : null,
    review: "Check this payment in the Flutterwave dashboard, then record the refund or chargeback in Admin → Rewards → Top-up reversals.",
  });
}

/**
 * An admin records a refund or chargeback they confirmed in the provider's dashboard. The ORIGINAL charge is
 * re-verified with its provider first (it must be ours and paid); the replay key makes a double press one reversal.
 */
export async function recordAdminTopupReversal(input: { reference: string; kind: ReversalKind; refundedMinor: number | null; idempotencyKey: string; adminId: string; note: string }): Promise<ReversalOutcome> {
  const provider = topupProvider(input.reference);
  if (!provider) return { ok: false, reason: "invalid" };
  let paidMinor: number | null = null;
  let paidCurrency: string | null = null;
  try {
    if (provider === "flutterwave") {
      const c = await verifyFlutterwaveByReference(input.reference);
      if (c.reference !== input.reference || c.status !== "success") return { ok: false, reason: "not_paid" };
      paidMinor = c.amountMinor;
      paidCurrency = c.currency;
    } else {
      const c = await verifyTransaction(input.reference);
      if (c.reference !== input.reference || !["success", "reversed"].includes(String(c.status))) return { ok: false, reason: "not_paid" };
      paidMinor = minor(c.amount);
      paidCurrency = typeof c.currency === "string" ? c.currency.toUpperCase() : null;
    }
  } catch {
    return { ok: false, reason: "error" };
  }
  if (input.refundedMinor !== null && (!paidMinor || input.refundedMinor > paidMinor)) return { ok: false, reason: "invalid" };
  return reverseWalletTopup({ provider, eventKey: `admin:${input.idempotencyKey}`, kind: input.kind, reference: input.reference, refundedMinor: input.refundedMinor, paidMinor, paidCurrency, actorId: input.adminId, note: input.note });
}

export async function resolveTopupDispute(id: string, outcome: "won" | "lost", adminId: string, note: string): Promise<{ ok: boolean; reason?: string; state?: string; duplicate?: boolean }> {
  const { data, error } = await createAdminClient().rpc("resolve_wallet_topup_dispute", { p_id: id, p_outcome: outcome, p_actor: adminId, p_note: note.slice(0, 500) });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; state?: string; duplicate?: boolean };
  return { ok: !!r.ok, reason: r.reason, state: r.state, duplicate: !!r.duplicate };
}

export async function clearTopupShortfall(id: string, adminId: string, note: string): Promise<{ ok: boolean; reason?: string; lifted?: boolean }> {
  const { data, error } = await createAdminClient().rpc("clear_wallet_topup_shortfall", { p_id: id, p_actor: adminId, p_note: note.slice(0, 500) });
  if (error) return { ok: false, reason: MISSING(error.message) ? "pending_migration" : "error" };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; lifted?: boolean };
  return { ok: !!r.ok, reason: r.reason, lifted: r.lifted };
}

export interface TopupReversalRow {
  id: string;
  provider: string;
  kind: string;
  reference: string;
  userId: string;
  state: string;
  due: number;
  recovered: number;
  shortfall: number;
  shortfallCleared: boolean;
  createdAt: string;
}

/** Newest first: what an admin must look at (held disputes, open shortfalls) and the recent history. */
export async function listTopupReversals(limit = 50): Promise<{ rows: TopupReversalRow[]; ready: boolean }> {
  const { data, error } = await createAdminClient()
    .from("wallet_topup_reversals")
    .select("id, provider, kind, reference, user_id, state, credits_due, credits_recovered, shortfall_credits, shortfall_cleared_at, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) return { rows: [], ready: !MISSING(error.message) };
  return {
    ready: true,
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      provider: String(r.provider),
      kind: String(r.kind),
      reference: String(r.reference),
      userId: String(r.user_id),
      state: String(r.state),
      due: Number(r.credits_due),
      recovered: Number(r.credits_recovered),
      shortfall: Number(r.shortfall_credits),
      shortfallCleared: !!r.shortfall_cleared_at,
      createdAt: String(r.created_at),
    })),
  };
}
