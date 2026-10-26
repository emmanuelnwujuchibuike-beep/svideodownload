import { NextResponse } from "next/server";
import { z } from "zod";

import { auditAdminAction, requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { restoreDisputedSub } from "@/lib/sub/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exclusive money reviews for admins (Part 12 follow-up).
 *
 *   refund reviews   Paystack refunds that were NOT applied automatically (a partial refund, or one
 *                    in another currency than the charge — reverseSubForRefund). Listed from the
 *                    financial audit log with what was charged and what was refunded. "Mark reviewed"
 *                    only writes an audit row: it never changes a balance or access.
 *   disputes         purchases reversed as disputed. "Dispute won" restores the earning and the access
 *                    the payment bought, once (0254) — after the admin confirmed the outcome in the
 *                    Paystack dashboard, because no provider event for a dispute's outcome is integrated.
 *
 * Admin only (getAdminUser) on every method. No secrets, no payer details: references, amounts,
 * currencies, times and states.
 */
const HEADERS = { "Cache-Control": "private, no-store" };
type Row = Record<string, unknown>;

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [reviews, closed, disputes, restored, payouts] = await Promise.all([
    db.from("financial_audit_log").select("id, action, reference, details, created_at").in("action", ["sub_partial_refund", "sub_refund_unrecognised"]).order("created_at", { ascending: false }).limit(100),
    db.from("financial_audit_log").select("details, actor_id, created_at").eq("action", "sub_refund_review_closed").order("created_at", { ascending: false }).limit(500),
    db.from("sub_purchases").select("id, reference, price_cents, charged_minor, charged_currency, reversed_at, paid_at").eq("status", "disputed").order("reversed_at", { ascending: false }).limit(100),
    db.from("financial_audit_log").select("reference, created_at").eq("action", "sub_dispute_won_restored").order("created_at", { ascending: false }).limit(100),
    // payouts the system could not settle by itself: paid after the money was released, or an AI-credit payout the bank returned
    db.from("financial_audit_log").select("id, action, target_id, reference, created_at").in("action", ["withdrawal_paid_after_release", "withdrawal_reversal_manual"]).order("created_at", { ascending: false }).limit(50),
  ]);
  const payoutAlerts = ((payouts.data ?? []) as Row[]).map((p) => ({ id: String(p.id), kind: p.action === "withdrawal_paid_after_release" ? "paid_after_release" : "ai_credit_returned", withdrawalId: p.target_id, reference: p.reference, at: p.created_at }));
  if (reviews.error || disputes.error) return NextResponse.json({ refundReviews: [], disputes: [], restored: [], payoutAlerts: [], ready: false }, { headers: HEADERS });
  const closedBy = new Map<string, Row>();
  for (const c of (closed.data ?? []) as Row[]) {
    const id = String((c.details as Row | null)?.review_id ?? "");
    if (id && !closedBy.has(id)) closedBy.set(id, c);
  }
  const refundReviews = ((reviews.data ?? []) as Row[]).map((r) => {
    const d = (r.details ?? {}) as Row;
    const c = closedBy.get(String(r.id));
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      id: String(r.id),
      kind: r.action === "sub_partial_refund" ? "partial" : "other_currency",
      reference: r.reference,
      chargedMinor: num(d.charged_minor),
      chargedCurrency: typeof d.charged_currency === "string" ? d.charged_currency : null,
      refundedMinor: num(d.refunded_minor),
      refundedCurrency: typeof d.currency === "string" ? d.currency : null,
      at: r.created_at,
      reviewed: c ? { at: c.created_at } : null,
    };
  });
  return NextResponse.json({ refundReviews, disputes: disputes.data ?? [], restored: restored.data ?? [], payoutAlerts, ready: true }, { headers: HEADERS });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close_refund_review"), id: z.string().regex(/^\d{1,18}$/), note: z.string().trim().min(3).max(300) }).strict(),
  z.object({ action: z.literal("restore_dispute"), reference: z.string().min(10).max(80), note: z.string().trim().min(3).max(300) }).strict(),
]);

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a note of at least 3 characters." }, { status: 400 });
  const db = createAdminClient();

  if (parsed.data.action === "close_refund_review") {
    const reviewId = parsed.data.id;
    const { data: review } = await db.from("financial_audit_log").select("id, reference, action").eq("id", Number(reviewId)).maybeSingle();
    const r = review as Row | null;
    if (!r || !["sub_partial_refund", "sub_refund_unrecognised"].includes(String(r.action))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { data: done } = await db.from("financial_audit_log").select("details").eq("action", "sub_refund_review_closed").eq("reference", String(r.reference)).limit(50);
    if (((done ?? []) as Row[]).some((d) => String((d.details as Row | null)?.review_id ?? "") === reviewId)) return NextResponse.json({ ok: true, duplicate: true });
    // a record that a person looked at it — no balance, access or purchase is touched
    const { error } = await db.from("financial_audit_log").insert({ actor_id: admin.id, action: "sub_refund_review_closed", target_type: "sub_purchase", reference: r.reference, details: { review_id: parsed.data.id, note: parsed.data.note } });
    if (error) return NextResponse.json({ error: "Couldn't save it." }, { status: 500 });
    console.info("[admin/sub] refund review closed", { admin: admin.id, review: parsed.data.id });
    return NextResponse.json({ ok: true });
  }

  // SENSITIVE (Frenz Coin Part 2, M4): restoring a dispute gives earnings back — a fresh password (closing a review moves nothing)
  const gate = await requireFinancialAdmin("sub.restore_dispute", parsed.data.reference);
  if (!gate.ok) return gate.response;
  const out = await restoreDisputedSub(parsed.data.reference, admin.id, parsed.data.note);
  console.info("[admin/sub] dispute restore", { admin: admin.id, reference: parsed.data.reference, ok: out.ok });
  await auditAdminAction(admin.id, out.ok ? "admin_sub_dispute_restored" : "admin_sub_dispute_restore_refused", "sub.restore_dispute", parsed.data.reference, {});
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error, reason: out.reason }, { status: out.status });
}
