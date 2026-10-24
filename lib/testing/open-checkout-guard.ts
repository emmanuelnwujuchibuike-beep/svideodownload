import type { FakeDb } from "./fake-supabase";

/**
 * In-memory models of migration 0276's begin_sub_purchase / begin_verification_purchase for fake-supabase.
 * Each handler is synchronous — the check and the insert happen in one turn of the event loop, exactly what
 * the transaction-scoped advisory lock gives the SQL — so "two requests at once" in a test behaves like two
 * calls serialised on the lock. The SQL itself (separate connections, a real lock) is proven by
 * supabase/tests/open_checkout_guard.pg.mjs.
 *
 * `writes` records each insert like a plain insert would, so tests that assert on the purchase table still see it.
 */
const WINDOW_MS = 30 * 60_000;

function begin(db: FakeDb, table: string, open: (r: Record<string, unknown>) => boolean, row: Record<string, unknown>) {
  const rows = (db.tables[table] ??= []);
  const recent = rows
    .filter((r) => r.status === "initiated" && open(r) && Date.now() - Date.parse(String(r.created_at)) < WINDOW_MS)
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)))[0];
  if (recent) return { data: { ok: false, reason: "open", reference: recent.reference, checkout_url: recent.checkout_url ?? null }, error: null };
  const inserted = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...db.defaults[table], status: "initiated", ...row };
  rows.push(inserted);
  db.writes.push({ table, op: "insert", values: [row], filters: [] });
  return { data: { ok: true, id: inserted.id }, error: null };
}

export function scriptOpenCheckoutGuard(db: FakeDb): void {
  db.rpc.begin_sub_purchase = (a) =>
    begin(db, "sub_purchases", (r) => r.subscriber_id === a.p_subscriber && r.creator_id === a.p_creator, {
      creator_id: a.p_creator,
      subscriber_id: a.p_subscriber,
      price_cents: a.p_price_cents,
      fee_cents: a.p_fee_cents,
      total_cents: a.p_total_cents,
      fee_bp: a.p_fee_bp,
      charged_currency: a.p_charged_currency,
      charged_minor: a.p_charged_minor,
      fx_minor_per_usd: a.p_fx_minor_per_usd,
      reference: a.p_reference,
      provider: a.p_provider,
      period_days: a.p_period_days,
      hold_days: a.p_hold_days,
    });
  db.rpc.begin_verification_purchase = (a) =>
    begin(db, "verification_purchases", (r) => r.user_id === a.p_user, {
      user_id: a.p_user,
      reference: a.p_reference,
      provider: a.p_provider,
      price_cents: a.p_price_cents,
      charged_currency: a.p_charged_currency,
      charged_minor: a.p_charged_minor,
      fx_minor_per_usd: a.p_fx_minor_per_usd,
      period_days: a.p_period_days,
    });
}
