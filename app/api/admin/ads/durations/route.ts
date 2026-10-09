import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/ads/durations — the campaign lengths on sale (owner, 2026-10-09:
 * "make admin can turn off a particular ad campaign period such as daily,
 * weekly or monthly").
 *
 * GET    every row of `ad_durations` (0195) with how many prices use it.
 * PATCH  { id, enabled } — switch one length on or off.
 *
 * Nothing new is enforced here because the database already enforces it:
 * advertisers read only enabled lengths (RLS "ad durations enabled or admin"),
 * and both the checkout quote and the extension quote refuse a disabled one
 * (`duration_disabled` in ad_campaign_quote / ad_price_for). Campaigns already
 * running keep their dates: switching a length off only stops new sales.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [durations, prices] = await Promise.all([
    db.from("ad_durations").select("id, name, duration_days, enabled, sort_order").order("sort_order", { ascending: true }),
    db.from("ad_pricing_plans").select("duration_id").eq("enabled", true),
  ]);
  if (durations.error) return NextResponse.json({ error: "Couldn't load the campaign lengths." }, { status: 503 });
  const priced = new Map<string, number>();
  for (const p of (prices.data ?? []) as { duration_id: string }[]) priced.set(p.duration_id, (priced.get(p.duration_id) ?? 0) + 1);
  const rows = (durations.data ?? []) as { id: string; name: string; duration_days: number; enabled: boolean }[];
  return NextResponse.json(
    { durations: rows.map((d) => ({ id: d.id, name: d.name, days: d.duration_days, enabled: d.enabled, prices: priced.get(d.id) ?? 0 })) },
    { headers: { "cache-control": "no-store" } },
  );
}

const patchSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict();

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { data, error } = await createAdminClient()
    .from("ad_durations")
    .update({ enabled: parsed.data.enabled, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id, enabled")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Couldn't save that." }, { status: error ? 503 : 404 });
  console.info("[admin/ads/durations] set", { by: admin.id, id: parsed.data.id, enabled: parsed.data.enabled });
  return NextResponse.json({ ok: true, id: data.id, enabled: data.enabled });
}
