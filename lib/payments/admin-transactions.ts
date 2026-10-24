import "server-only";

import { PAYMENT_PURPOSES, type PaymentPurpose } from "@/lib/ai/credits/wallet-config";
import { PLAN_ATTEMPT_COLUMNS, reconcilePlanAttempt, type PlanAttemptRow } from "@/lib/ai/credits/plan-attempts";
import { reconcileTopupAttempt, TOPUP_ATTEMPT_COLUMNS, type TopupAttemptRow } from "@/lib/ai/wallet/reconcile-topups";
import { reconcileAdAttempt } from "@/lib/ads-platform/payment-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { confirmVerificationPayment } from "@/lib/social/paid-verification";
import { confirmSubPayment } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 5 — the admin's view of payment attempts and provider events, and a "Recheck" for one of them.
 *
 * READ: the EXISTING ledgers, nothing new — `ai_topup_attempts` (wallet top-ups, ads, AI plans, site plans),
 * `sub_purchases`, `verification_purchases` — plus the webhook log `payment_provider_events`. One row shape for the
 * table; the reconciliation state is DERIVED from each ledger's own status (nothing is written by reading).
 *
 * RECHECK: an admin names a REFERENCE — never a status, an amount or "paid". The server finds the attempt in its own
 * ledger and runs the SAME step the cron / webhook / return page runs for that purpose, which asks the provider and
 * settles through the existing idempotent function (a lease or a conditional update: a parallel webhook, cron or second
 * click answers "already done"). A closed attempt is answered from the database, never re-asked. Every recheck is
 * written to `financial_audit_log` with the admin, the reference and the before/after status.
 */

export type LedgerSource = "ai_topup_attempts" | "sub_purchases" | "verification_purchases";
export type ReconciliationState = "settled" | "open" | "needs_check" | "review" | "closed";
export const RECONCILIATION_STATES: readonly ReconciliationState[] = ["settled", "open", "needs_check", "review", "closed"];

export interface AdminPaymentRow {
  source: LedgerSource;
  reference: string;
  provider: string;
  purpose: PaymentPurpose | "unknown";
  status: string;
  state: ReconciliationState;
  amountMinor: number | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string | null;
  /** why it closed or is held, as the ledger recorded it (status_reason / failure_source) */
  reason: string | null;
  hasCheckoutLink: boolean;
  userId: string | null;
}

export interface AdminProviderEvent {
  provider: string;
  eventType: string;
  reference: string | null;
  receivedAt: string;
  processedAt: string | null;
  outcome: string | null;
}

/** A link-less `initiated` purchase this old is past any in-flight request (initialize times out at 15 s). */
const HELD_AFTER_MS = 60_000;

/** The reconciliation state, from the ledger's own status (pure). */
export function reconciliationState(status: string, hasLink: boolean, createdAt: string, now = Date.now()): ReconciliationState {
  if (status === "success" || status === "paid") return "settled";
  if (status === "verification_required") return "needs_check";
  if (status === "mismatch" || status === "refund_due") return "review";
  if (status === "pending" || status === "initiated") {
    // no link handed out and past any in-flight request: its creation outcome is unknown until asked
    return !hasLink && now - Date.parse(createdAt) >= HELD_AFTER_MS ? "needs_check" : "open";
  }
  return "closed";
}

const PURPOSE_SET = new Set<string>(PAYMENT_PURPOSES);
const purposeOf = (v: unknown): PaymentPurpose | "unknown" => (typeof v === "string" && PURPOSE_SET.has(v) ? (v as PaymentPurpose) : "unknown");
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
type Row = Record<string, unknown>;
/** The few PostgREST calls the list makes, typed structurally (the generated builder types are too deep to compose). */
interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): Query;
  order(column: string, opts: { ascending: boolean }): Query;
  limit(n: number): Query;
}
const table = (name: string, columns: string): Query => createAdminClient().from(name).select(columns) as unknown as Query;

export interface TransactionFilter {
  provider?: "flutterwave" | "paystack";
  purpose?: PaymentPurpose;
  state?: ReconciliationState;
  /** an exact reference */
  reference?: string;
  limit?: number;
}

/** A reference an admin may search for or recheck: our own shape only. */
export const isAdminReference = (r: unknown): r is string => typeof r === "string" && /^frenz_[A-Za-z0-9_-]{4,100}$/.test(r);

export async function listAdminTransactions(f: TransactionFilter = {}, now = Date.now()): Promise<{ rows: AdminPaymentRow[]; events: AdminProviderEvent[]; unavailable: LedgerSource[] }> {
  const limit = Math.max(1, Math.min(100, f.limit ?? 50));
  const ref = f.reference && isAdminReference(f.reference) ? f.reference : null;
  const narrow = (q: Query): Query => {
    let out = q;
    if (f.provider) out = out.eq("provider", f.provider);
    if (ref) out = out.eq("reference", ref);
    return out;
  };
  const unavailable: LedgerSource[] = [];
  const rows: AdminPaymentRow[] = [];

  // the attempt ledger: wallet top-ups, ads, AI plans, site plans
  if (!f.purpose || ["wallet_topup", "ad_campaign", "ai_subscription", "site_subscription"].includes(f.purpose)) {
    let q = narrow(table("ai_topup_attempts", "reference, user_id, provider, status, purpose, amount_cents, currency, provider_amount, provider_currency, status_reason, checkout_url, created_at, updated_at"));
    if (f.purpose) q = q.eq("purpose", f.purpose);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) unavailable.push("ai_topup_attempts");
    for (const r of (data ?? []) as Row[]) {
      const hasLink = !!r.checkout_url;
      rows.push({
        source: "ai_topup_attempts",
        reference: String(r.reference),
        provider: String(r.provider ?? ""),
        purpose: purposeOf(r.purpose),
        status: String(r.status ?? ""),
        state: reconciliationState(String(r.status ?? ""), hasLink, String(r.created_at), now),
        amountMinor: num(r.provider_amount) ?? num(r.amount_cents),
        currency: (r.provider_currency as string | null) ?? (r.currency as string | null) ?? null,
        createdAt: String(r.created_at),
        updatedAt: (r.updated_at as string | null) ?? null,
        reason: (r.status_reason as string | null) ?? null,
        hasCheckoutLink: hasLink,
        userId: (r.user_id as string | null) ?? null,
      });
    }
  }

  // the two purchase ledgers
  const purchases: { source: LedgerSource; purpose: PaymentPurpose; table: "sub_purchases" | "verification_purchases"; user: string }[] = [
    { source: "sub_purchases", purpose: "sub_purchase", table: "sub_purchases", user: "subscriber_id" },
    { source: "verification_purchases", purpose: "verification", table: "verification_purchases", user: "user_id" },
  ];
  for (const p of purchases) {
    if (f.purpose && f.purpose !== p.purpose) continue;
    const cols = `reference, ${p.user}, provider, status, charged_minor, charged_currency, failure_source, checkout_url, created_at, updated_at`;
    const { data, error } = await narrow(table(p.table, cols)).order("created_at", { ascending: false }).limit(limit);
    if (error) {
      unavailable.push(p.source);
      continue;
    }
    for (const r of (data ?? []) as Row[]) {
      const hasLink = !!r.checkout_url;
      rows.push({
        source: p.source,
        reference: String(r.reference),
        provider: String(r.provider ?? "paystack"),
        purpose: p.purpose,
        status: String(r.status ?? ""),
        state: reconciliationState(String(r.status ?? ""), hasLink, String(r.created_at), now),
        amountMinor: num(r.charged_minor),
        currency: (r.charged_currency as string | null) ?? null,
        createdAt: String(r.created_at),
        updatedAt: (r.updated_at as string | null) ?? null,
        reason: (r.failure_source as string | null) ?? null,
        hasCheckoutLink: hasLink,
        userId: (r[p.user] as string | null) ?? null,
      });
    }
  }

  const filtered = (f.state ? rows.filter((r) => r.state === f.state) : rows).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);

  // the webhook log: what each provider told us, and what was done with it
  let eq = table("payment_provider_events", "provider, event_type, reference, received_at, processed_at, outcome");
  if (f.provider) eq = eq.eq("provider", f.provider);
  if (ref) eq = eq.eq("reference", ref);
  const { data: ev } = await eq.order("received_at", { ascending: false }).limit(limit);
  const events = ((ev ?? []) as Row[]).map((e) => ({
    provider: String(e.provider),
    eventType: String(e.event_type),
    reference: (e.reference as string | null) ?? null,
    receivedAt: String(e.received_at),
    processedAt: (e.processed_at as string | null) ?? null,
    outcome: (e.outcome as string | null) ?? null,
  }));
  return { rows: filtered, events, unavailable };
}

/* ───────────────────────────── recheck ───────────────────────────── */

export type RecheckResult =
  | { ok: true; source: LedgerSource; purpose: PaymentPurpose | "unknown"; before: string; after: string; outcome: string }
  | { ok: false; code: "bad_reference" | "not_found" | "unsupported"; message: string };

const OPEN = new Set(["pending", "verification_required", "initiated"]);

async function statusOf(table: LedgerSource, reference: string): Promise<string> {
  const { data } = await createAdminClient().from(table).select("status").eq("reference", reference).maybeSingle();
  return String((data as Row | null)?.status ?? "");
}

/**
 * Ask the provider about ONE attempt, through its purpose's existing path. `adminId` is recorded; nothing the browser
 * says about the payment is read. Idempotent end to end: the settle functions answer a repeat with "already done".
 */
export async function adminRecheckPayment(reference: string, adminId: string): Promise<RecheckResult> {
  if (!isAdminReference(reference)) return { ok: false, code: "bad_reference", message: "That isn't a Frenz payment reference." };
  const db = createAdminClient();

  let source: LedgerSource | null = null;
  let purpose: PaymentPurpose | "unknown" = "unknown";
  let before = "";
  let outcome = "";

  const { data: attempt } = await db.from("ai_topup_attempts").select("purpose, status").eq("reference", reference).maybeSingle();
  if (attempt) {
    source = "ai_topup_attempts";
    purpose = purposeOf((attempt as Row).purpose);
    before = String((attempt as Row).status ?? "");
    if (!OPEN.has(before)) outcome = "already_closed";
    else if (purpose === "wallet_topup") {
      const { data } = await db.from("ai_topup_attempts").select(TOPUP_ATTEMPT_COLUMNS).eq("reference", reference).maybeSingle();
      outcome = data ? await reconcileTopupAttempt(data as unknown as TopupAttemptRow) : "not_found";
    } else if (purpose === "ai_subscription" || purpose === "site_subscription") {
      const { data } = await db.from("ai_topup_attempts").select(PLAN_ATTEMPT_COLUMNS).eq("reference", reference).maybeSingle();
      const config = (await getLandingSettings()).frenzAiPlans;
      outcome = data ? await reconcilePlanAttempt(data as unknown as PlanAttemptRow, config) : "not_found";
    } else if (purpose === "ad_campaign") {
      outcome = await reconcileAdAttempt(db as never, reference);
    } else {
      return { ok: false, code: "unsupported", message: "This attempt's purpose has no recheck path." };
    }
  } else {
    const sub = await db.from("sub_purchases").select("status").eq("reference", reference).maybeSingle();
    if (sub.data) {
      source = "sub_purchases";
      purpose = "sub_purchase";
      before = String((sub.data as Row).status ?? "");
      outcome = OPEN.has(before) ? (await confirmSubPayment(reference)).status : "already_closed";
    } else {
      const ver = await db.from("verification_purchases").select("status").eq("reference", reference).maybeSingle();
      if (ver.data) {
        source = "verification_purchases";
        purpose = "verification";
        before = String((ver.data as Row).status ?? "");
        outcome = OPEN.has(before) ? await confirmVerificationPayment(reference) : "already_closed";
      }
    }
  }
  if (!source) return { ok: false, code: "not_found", message: "No payment attempt has that reference." };

  const after = await statusOf(source, reference);
  // the audit trail: who asked, about what, and what the ledger says now (never amounts typed by anyone)
  const { error } = await db.from("financial_audit_log").insert({ actor_id: adminId, action: "admin_payment_recheck", target_type: source, target_id: null, reference, details: { purpose, before, after, outcome } });
  if (error) console.error("[admin/payments] recheck audit write failed", { reference });
  return { ok: true, source, purpose, before, after, outcome };
}
