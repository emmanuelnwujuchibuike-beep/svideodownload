import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { AD_SLOT_PROVIDER_ORDER_KEY } from "@/lib/ads-platform/server";
import { MOMENT_SLOTS } from "@/lib/ads-platform/slot-moments";
import { SLOT_DESCRIPTIONS } from "@/lib/ads-platform/slot-inventory";
import { AD_SLOTS, providerOrder, type SlotSpec } from "@/lib/ads-platform/slot-registry";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL: readonly SlotSpec[] = [...AD_SLOTS, ...MOMENT_SLOTS];

/**
 * /api/admin/ads/slots — the canonical PHYSICAL ad inventory for the admin
 * (owner, 2026-10-08, shared-slot addendum §16/§60): "who is allowed to
 * occupy this location?" — never "create another location".
 *
 * GET  every slot with its existing network zone (and how many active rows
 *      fill it), its paid placement (enabled? how many live campaigns?) and
 *      the provider order in force.
 * PUT  { slot, order } — set who may occupy one slot and in which order.
 *      Validated against the registry: a slot with no network zone can never
 *      be given "network", nor one with no paid placement "frenzsave".
 *      Stored in `settings.ad_slot_provider_order`, which the serving payload
 *      already reads; it reaches visitors within one 5-minute CDN bucket.
 */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = createAdminClient();
  const now = new Date().toISOString();
  const [orderRow, placements, zoneRows, live] = await Promise.all([
    db.from("settings").select("value").eq("key", AD_SLOT_PROVIDER_ORDER_KEY).maybeSingle(),
    db.from("ad_placements").select("code, name, format_code, page_scope, enabled"),
    db.from("ads").select("zone, active"),
    db.from("ad_campaigns").select("id, placement_id, ad_placements!inner(code)").eq("status", "active").gt("end_at", now),
  ]);
  const configured = (orderRow.data?.value ?? null) as Record<string, unknown> | null;
  const byCode = new Map(((placements.data ?? []) as { code: string; name: string; format_code: string; page_scope: string[]; enabled: boolean }[]).map((p) => [p.code, p]));
  const activeRows = new Map<string, number>();
  for (const r of (zoneRows.data ?? []) as { zone: string; active: boolean }[]) if (r.active) activeRows.set(r.zone, (activeRows.get(r.zone) ?? 0) + 1);
  const liveByPlacement = new Map<string, number>();
  for (const c of (live.data ?? []) as unknown as { ad_placements: { code: string } | { code: string }[] }[]) {
    const code = Array.isArray(c.ad_placements) ? c.ad_placements[0]?.code : c.ad_placements?.code;
    if (code) liveByPlacement.set(code, (liveByPlacement.get(code) ?? 0) + 1);
  }

  const slots = ALL.map((s) => {
    const p = s.paidPlacement ? byCode.get(s.paidPlacement) : undefined;
    return {
      id: s.id,
      kind: s.kind,
      ...SLOT_DESCRIPTIONS[s.id],
      pages: s.pages,
      aspect: s.aspect,
      networkZone: s.networkZone,
      networkActiveRows: s.networkZone ? (activeRows.get(s.networkZone) ?? 0) : null,
      paidPlacement: s.paidPlacement,
      paidName: p?.name ?? null,
      paidFormat: p?.format_code ?? null,
      paidEnabled: p ? p.enabled : null,
      paidLiveCampaigns: s.paidPlacement ? (liveByPlacement.get(s.paidPlacement) ?? 0) : null,
      order: providerOrder(s, configured),
      defaultOrder: s.order,
      customised: Array.isArray(configured?.[s.id]),
    };
  });
  return NextResponse.json({ slots, errors: [orderRow.error, placements.error, zoneRows.error, live.error].filter(Boolean).map((e) => e!.message) });
}

const putSchema = z.object({
  slot: z.string().min(1).max(64),
  order: z.array(z.enum(["frenzsave", "network"])).min(1).max(2),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  const slot = ALL.find((s) => s.id === parsed.data.slot);
  if (!slot) return NextResponse.json({ error: "Unknown slot." }, { status: 400 });
  const order = [...new Set(parsed.data.order)];
  if (order.includes("network") && !slot.networkZone) return NextResponse.json({ error: "This slot has no network zone." }, { status: 400 });
  if (order.includes("frenzsave") && !slot.paidPlacement) return NextResponse.json({ error: "This slot has no paid placement." }, { status: 400 });

  const db = createAdminClient();
  const { data } = await db.from("settings").select("value").eq("key", AD_SLOT_PROVIDER_ORDER_KEY).maybeSingle();
  const current = data?.value && typeof data.value === "object" && !Array.isArray(data.value) ? (data.value as Record<string, unknown>) : {};
  const next = { ...current, [slot.id]: order };
  const { error } = await db.from("settings").upsert({ key: AD_SLOT_PROVIDER_ORDER_KEY, value: next }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true, slot: slot.id, order });
}
