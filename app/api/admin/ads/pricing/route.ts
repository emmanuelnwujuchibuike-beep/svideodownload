import { NextResponse } from "next/server";

import { loadPricing, priceSchema, promotionSchema, savePrice, savePromotion } from "@/lib/ads-platform/admin-platform";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/ads/pricing — Ad Platform Part 7, prices and promotions.
 *
 * GET                  placements, lengths, every price row and the promotions
 * PUT  price           { placementId, durationId, currency, priceMinor, enabled }
 * POST promotion       { id?, name, …, enabled } — create, or edit when id is sent
 *
 * The database prices every quote from these rows (ad_price_for, 0198); an open
 * quote keeps the price the advertiser was already shown.
 */
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await loadPricing(createAdminClient()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/pricing] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load prices." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = priceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid price." }, { status: 400 });
  try {
    await savePrice(createAdminClient(), parsed.data);
    console.info("[admin/ads/pricing] price", { by: gate.user.id, ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[admin/ads/pricing] price failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't save that price." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = promotionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid promotion." }, { status: 400 });
  try {
    const id = await savePromotion(createAdminClient(), parsed.data);
    console.info("[admin/ads/pricing] promotion", { by: gate.user.id, id, enabled: parsed.data.enabled });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error("[admin/ads/pricing] promotion failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't save that promotion." }, { status: 503 });
  }
}
