import { NextResponse } from "next/server";
import { z } from "zod";

import { campaignEvents, listAdminCampaigns, MODERATION_ACTIONS, moderateCampaign, setRefund, setStatsBoost, setStatsBoostAllLive } from "@/lib/ads-platform/admin-campaigns";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * /api/admin/ads/campaigns — Ad Platform Part 7, the review desk.
 *
 * GET  ?view=review|live|refunds|all&status=&q=   campaigns with creatives, flags, refund state, totals
 * GET  ?events=<campaign id>                      that campaign's audit trail
 * POST { id, action, version, reason }            approve · reject · pause · resume · remove (0204)
 * POST { id, statsMultiplier: 1 | 10 }          test mode: dashboard figures x10 (0212, display only)
 * POST { allLive: true, statsMultiplier }        the same for every live campaign at once
 * POST { id, refund: "refunded" | "waived", note } the refund decision
 *
 * Admins only (404 otherwise). Fetched when the panel opens, never polled.
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const p = new URL(request.url).searchParams;
  const db = createAdminClient();
  try {
    const eventsFor = p.get("events");
    if (eventsFor) {
      if (!z.string().uuid().safeParse(eventsFor).success) return NextResponse.json({ error: "Invalid campaign." }, { status: 400 });
      return NextResponse.json({ events: await campaignEvents(db, eventsFor) }, { headers: NO_STORE });
    }
    const out = await listAdminCampaigns(db, { view: p.get("view") ?? undefined, status: p.get("status") ?? undefined, q: p.get("q") ?? undefined });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e) {
    console.error("[admin/ads/campaigns] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load campaigns." }, { status: 503 });
  }
}

const boostSchema = z.object({ id: z.string().uuid(), statsMultiplier: z.union([z.literal(1), z.literal(10)]) }).strict();
const boostAllSchema = z.object({ allLive: z.literal(true), statsMultiplier: z.union([z.literal(1), z.literal(10)]) }).strict();
const moderateSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(MODERATION_ACTIONS),
    version: z.number().int().positive().nullable(),
    reason: z.string().trim().max(300).nullable().optional(),
  })
  .strict();
const refundSchema = z
  .object({ id: z.string().uuid(), refund: z.enum(["refunded", "waived"]), note: z.string().trim().max(300).nullable().optional() })
  .strict();

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const body: unknown = await request.json().catch(() => null);
  const db = createAdminClient();
  try {
    const boostAll = boostAllSchema.safeParse(body);
    if (boostAll.success) {
      const out = await setStatsBoostAllLive(db, gate.user.id, boostAll.data.statsMultiplier);
      console.info("[admin/ads/campaigns] stats boost all live", { by: gate.user.id, multiplier: boostAll.data.statsMultiplier, ...out });
      return NextResponse.json(out, { status: out.ok ? 200 : 409, headers: NO_STORE });
    }
    const boost = boostSchema.safeParse(body);
    if (boost.success) {
      const out = await setStatsBoost(db, gate.user.id, { id: boost.data.id, multiplier: boost.data.statsMultiplier });
      console.info("[admin/ads/campaigns] stats boost", { by: gate.user.id, id: boost.data.id, multiplier: boost.data.statsMultiplier, ok: out.ok });
      return NextResponse.json(out, { status: out.ok ? 200 : 409, headers: NO_STORE });
    }
    const refund = refundSchema.safeParse(body);
    if (refund.success) {
      const out = await setRefund(db, gate.user.id, { id: refund.data.id, status: refund.data.refund, note: refund.data.note || null });
      console.info("[admin/ads/campaigns] refund", { by: gate.user.id, id: refund.data.id, status: refund.data.refund, ok: out.ok });
      return NextResponse.json(out, { status: out.ok ? 200 : 409, headers: NO_STORE });
    }
    const parsed = moderateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const out = await moderateCampaign(db, gate.user.id, { id: parsed.data.id, action: parsed.data.action, version: parsed.data.version, reason: parsed.data.reason || null });
    console.info("[admin/ads/campaigns] moderate", { by: gate.user.id, id: parsed.data.id, action: parsed.data.action, ok: out.ok, reason: out.reason });
    // a flagged approval is an answer, not a failure: the flags say what still blocks it
    return NextResponse.json(out, { status: out.ok || out.reason === "flagged" ? 200 : 409, headers: NO_STORE });
  } catch (e) {
    console.error("[admin/ads/campaigns] action failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "That didn't go through. Nothing changed." }, { status: 503 });
  }
}
