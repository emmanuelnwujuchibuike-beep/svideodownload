import type { FakeDb } from "@/lib/testing/fake-supabase";

/**
 * A MODEL of migration 0274's two functions (with 0275's duplicate → close-review change), for application-level tests over the fake database. It follows the SQL
 * step by step (same checks, same order, same results) so the TypeScript around it can be exercised end to end.
 *
 * ⚠️ It proves nothing about the database itself: the real functions — locking, the unique ledger key, the re-check under
 * the lock — are proven against PostgreSQL by supabase/tests/0274_plan_billing.pglite.mjs (logic, mutants) and
 * supabase/tests/plan_billing_concurrency.pg.mjs (real concurrent connections).
 */

const MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, "bi-annually": 6, yearly: 12 };
const DAYS: Record<string, number> = { daily: 1, weekly: 7 };

export function addPlanInterval(fromMs: number, interval: string): number | null {
  if (MONTHS[interval]) {
    const d = new Date(fromMs);
    d.setUTCMonth(d.getUTCMonth() + MONTHS[interval]!);
    return d.getTime();
  }
  if (DAYS[interval]) return fromMs + DAYS[interval]! * 86_400_000;
  return null;
}

type Row = Record<string, unknown>;

export function scriptPlanBillingRpcs(db: FakeDb): void {
  db.tables.plan_renewals ??= [];
  db.tables.plan_billing_reviews ??= [];
  db.unique.plan_billing_reviews = [["dedupe_key"]];
  db.defaults.plan_billing_reviews = { status: "open", provider: "flutterwave" };

  db.rpc.apply_plan_renewal = (a: Row) => {
    const tx = String(a.p_transaction_id ?? "");
    const ok = (result: string, extra: Row = {}) => ({ data: { result, ...extra }, error: null });
    if (a.p_provider !== "flutterwave" || !/^\d{1,20}$/.test(tx) || !["ai_subscription", "site_subscription"].includes(String(a.p_target)) || !a.p_user_id || !a.p_subscription_ref || !(Number(a.p_amount_minor) > 0) || !/^[A-Z]{3}$/.test(String(a.p_currency ?? "")) || !["webhook", "reconcile", "admin"].includes(String(a.p_source))) return ok("invalid");
    const table = a.p_target === "ai_subscription" ? "ai_subscriptions" : "subscriptions";
    const row = (db.tables[table] ?? []).find((r) => r.user_id === a.p_user_id);
    if (!row) return ok("no_subscription");
    if ((db.tables.plan_renewals ?? []).some((r) => r.provider === a.p_provider && r.transaction_id === tx)) {
      // 0275: an already-applied transaction closes its open review before answering "duplicate"
      for (const r of db.tables.plan_billing_reviews ?? []) if (r.dedupe_key === `renewal:${a.p_provider}:${tx}` && r.status === "open") Object.assign(r, { status: "applied", resolution_note: r.resolution_note ?? "already applied", resolved_by: r.resolved_by ?? a.p_admin ?? null });
      return ok("duplicate");
    }
    if (row.provider !== a.p_provider || row.subscription_ref !== a.p_subscription_ref) return ok("identity_mismatch");
    if (a.p_plan_code != null && row.plan_code !== a.p_plan_code) return ok("plan_mismatch");
    const interval = String(row.contract_interval ?? "");
    if (row.contract_amount_minor == null || row.contract_currency == null || addPlanInterval(0, interval) === null) return ok("no_contract");
    if (Number(row.contract_amount_minor) !== Number(a.p_amount_minor) || row.contract_currency !== a.p_currency) return ok("contract_mismatch");
    const end = row.current_period_end ? Date.parse(String(row.current_period_end)) : null;
    const base = Math.max(end ?? Date.now(), Date.now());
    const next = new Date(addPlanInterval(base, interval)!).toISOString();
    db.tables.plan_renewals!.push({ id: `r${db.tables.plan_renewals!.length + 1}`, provider: a.p_provider, transaction_id: tx, target: a.p_target, user_id: a.p_user_id, subscription_ref: a.p_subscription_ref, plan_code: row.plan_code, amount_minor: a.p_amount_minor, currency: a.p_currency, period_end_before: row.current_period_end ?? null, period_end_after: next, source: a.p_source, applied_by: a.p_admin ?? null });
    Object.assign(row, { current_period_end: next, status: "active", last_reference: `flw_tx_${tx}`, updated_at: new Date().toISOString() });
    if (a.p_target === "ai_subscription") row.current_period_start = new Date(base).toISOString();
    else for (const p of db.tables.profiles ?? []) if (p.id === a.p_user_id && p.role === "user") p.role = "pro";
    for (const r of db.tables.plan_billing_reviews ?? []) if (r.dedupe_key === `renewal:${a.p_provider}:${tx}` && r.status === "open") Object.assign(r, { status: "applied", resolved_by: a.p_admin ?? null });
    return ok("applied", { period_end_before: end === null ? null : new Date(end).toISOString(), period_end_after: next });
  };

  db.rpc.expire_flutterwave_site_plan = (a: Row) => {
    const row = (db.tables.subscriptions ?? []).find((r) => r.user_id === a.p_user_id && r.provider === "flutterwave");
    if (!row) return { data: "no_subscription", error: null };
    if (row.status !== "active" && row.status !== "trialing") return { data: "not_active", error: null };
    const end = row.current_period_end ? Date.parse(String(row.current_period_end)) : null;
    const cutoff = end === null ? null : row.cancel_at_period_end ? end : end + 3 * 86_400_000;
    if (cutoff !== null && Date.now() <= cutoff) return { data: "not_expired", error: null };
    row.status = row.cancel_at_period_end ? "canceled" : "past_due";
    for (const p of db.tables.profiles ?? []) if (p.id === a.p_user_id && p.role === "pro") p.role = "user";
    return { data: "expired", error: null };
  };
}
