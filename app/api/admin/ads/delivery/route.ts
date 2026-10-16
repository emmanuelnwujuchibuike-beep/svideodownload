import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { deliveryActionSchema, deliveryDetail, deliveryFiltersSchema, deliveryOverview, DELIVERY_REFUSALS, runDeliveryAction } from "@/lib/ads-platform/admin-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/ads/delivery — Part 3 (0242), the delivery monitor. Admin only.
 *
 * GET ?f=<json filters>&page=n   cards + one page of campaigns + capacity
 * GET ?id=<campaign>             one campaign's delivery, counters, adjustments, audit
 * POST { action, … }             extend · close_refund · adjust (reason-coded) · recheck
 *
 * Fetched when the tab is shown and when the admin changes a filter (never per
 * keystroke — the tab applies filters on submit). No polling.
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const db = createAdminClient();
  try {
    const id = url.searchParams.get("id");
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid campaign." }, { status: 400 });
      return NextResponse.json(await deliveryDetail(db, id), { headers: { "cache-control": "no-store" } });
    }
    let raw: unknown = {};
    try {
      raw = JSON.parse(url.searchParams.get("f") ?? "{}");
    } catch {
      return NextResponse.json({ error: "Invalid filters." }, { status: 400 });
    }
    const filters = deliveryFiltersSchema.safeParse(raw);
    if (!filters.success) return NextResponse.json({ error: "Invalid filters." }, { status: 400 });
    const page = Math.min(500, Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0));
    return NextResponse.json(await deliveryOverview(db, filters.data, page), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/delivery] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load delivery." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = deliveryActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the form: a reason of at least five characters is required." }, { status: 400 });
  try {
    const out = await runDeliveryAction(createAdminClient(), gate.user.id, parsed.data);
    console.info("[admin/ads/delivery] action", { by: gate.user.id, action: parsed.data.action, campaign: parsed.data.campaignId, ok: out.ok });
    if (out.ok === false) {
      const reason = String(out.reason ?? "");
      return NextResponse.json({ error: DELIVERY_REFUSALS[reason] ?? "That change wasn't allowed.", reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[admin/ads/delivery] action failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't do that. Nothing changed." }, { status: 503 });
  }
}
