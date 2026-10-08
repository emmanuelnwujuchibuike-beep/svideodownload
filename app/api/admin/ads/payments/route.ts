import { NextResponse } from "next/server";

import { adminPaymentAction, listAdPayments } from "@/lib/ads-platform/admin-payments";
import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/ads/payments?provider=&status=&campaignStatus=&currency=&advertiser=&from=&to=
 *      ad payments (the shared attempt ledger, purpose ad_campaign) with their
 *      campaigns, plus every reconciliation flag (ad_payment_inconsistencies).
 * POST { reference, action: "recheck" | "activate" } — idempotent repairs.
 * Admins only; fetched when the panel is opened, never polled.
 */
export async function GET(request: Request) {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  try {
    const out = await listAdPayments(createAdminClient(), {
      provider: p.get("provider") ?? undefined,
      status: p.get("status") ?? undefined,
      campaignStatus: p.get("campaignStatus") ?? undefined,
      currency: p.get("currency") ?? undefined,
      advertiser: p.get("advertiser") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      limit: Number(p.get("limit") ?? 50),
    });
    return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/payments] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load ad payments." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await getAdminUser())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { reference?: unknown; action?: unknown } | null;
  const reference = typeof body?.reference === "string" ? body.reference.slice(0, 120) : "";
  const action = body?.action === "recheck" || body?.action === "activate" ? body.action : null;
  if (!reference || !action) return NextResponse.json({ error: "reference and action are required" }, { status: 400 });
  try {
    return NextResponse.json(await adminPaymentAction(createAdminClient(), reference, action), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/payments] action failed", { reference, action, error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Action failed." }, { status: 500 });
  }
}
