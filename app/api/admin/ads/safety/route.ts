import { NextResponse } from "next/server";
import { z } from "zod";

import { loadSafetyOverview, resolveFlag, revalidateCampaign, rulesPatchSchema, saveTrafficRules } from "@/lib/ads-platform/admin-safety";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * /api/admin/ads/safety — Ad Platform Part 8, the Traffic & safety centre.
 *
 * GET   ?view=open|resolved                 flags, 7-day traffic quality, creative and link problems, rules
 * POST  { flag, action, note, exclude }     dismiss or confirm a flag (a note is required; audited)
 * POST  { revalidate: campaignId }          re-run every creative and link check on a campaign
 * PATCH { rules: {...} }                    the traffic thresholds (bounded)
 *
 * Admins only (404 otherwise). Fetched when the tab opens, never polled.
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const view = new URL(request.url).searchParams.get("view") === "resolved" ? "resolved" : "open";
  try {
    return NextResponse.json(await loadSafetyOverview(createAdminClient(), view), { headers: NO_STORE });
  } catch (e) {
    console.error("[admin/ads/safety] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load traffic and safety." }, { status: 503 });
  }
}

const resolveSchema = z
  .object({ flag: z.number().int().positive(), action: z.enum(["dismiss", "confirm"]), note: z.string().trim().min(1).max(500), exclude: z.boolean().optional() })
  .strict();
const revalidateSchema = z.object({ revalidate: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const body: unknown = await request.json().catch(() => null);
  const db = createAdminClient();
  try {
    const re = revalidateSchema.safeParse(body);
    if (re.success) {
      const out = await revalidateCampaign(db, re.data.revalidate);
      console.info("[admin/ads/safety] revalidate", { by: gate.user.id, campaign: re.data.revalidate, ...out });
      return NextResponse.json({ ok: true, ...out }, { headers: NO_STORE });
    }
    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const out = await resolveFlag(db, gate.user.id, { id: parsed.data.flag, action: parsed.data.action, note: parsed.data.note, exclude: parsed.data.exclude ?? false });
    console.info("[admin/ads/safety] resolve", { by: gate.user.id, flag: parsed.data.flag, action: parsed.data.action, ok: out.ok });
    return NextResponse.json(out, { status: out.ok ? 200 : 409, headers: NO_STORE });
  } catch (e) {
    console.error("[admin/ads/safety] action failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "That didn't go through. Nothing changed." }, { status: 503 });
  }
}

const patchSchema = z.object({ rules: rulesPatchSchema }).strict();

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rules." }, { status: 400 });
  try {
    const rules = await saveTrafficRules(createAdminClient(), parsed.data.rules);
    console.info("[admin/ads/safety] rules", { by: gate.user.id, keys: Object.keys(parsed.data.rules) });
    return NextResponse.json({ ok: true, rules });
  } catch (e) {
    console.error("[admin/ads/safety] rules failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't save the rules." }, { status: 503 });
  }
}
