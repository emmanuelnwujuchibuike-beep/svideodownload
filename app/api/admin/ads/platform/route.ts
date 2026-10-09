import { NextResponse } from "next/server";
import { z } from "zod";

import { addBlockedDomain, controlsSchema, loadPlatform, normalizeBlockedDomain, platformSettingsSchema, removeBlockedDomain, saveControls, saveSettings } from "@/lib/ads-platform/admin-platform";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/ads/platform — Ad Platform Part 7, the self-serve switches.
 *
 * GET                          ad_platform_settings + advertiser controls + blocked domains
 * PATCH { settings?, controls? }  partial: only the fields sent change
 * POST  { domain, reason }     block a destination (a host and every subdomain)
 * DELETE ?domain=              unblock it
 *
 * A switch reaches visitors within one 5-minute serving bucket (by design, Part 1).
 */
export async function GET() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await loadPlatform(createAdminClient()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/platform] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load the ad platform settings." }, { status: 503 });
  }
}

const patchSchema = z.object({ settings: platformSettingsSchema.optional(), controls: controlsSchema.optional() }).strict();

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.settings && !parsed.data.controls)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const db = createAdminClient();
  try {
    const out: Record<string, unknown> = {};
    if (parsed.data.settings && Object.keys(parsed.data.settings).length) out.settings = await saveSettings(db, gate.user.id, parsed.data.settings);
    if (parsed.data.controls && Object.keys(parsed.data.controls).length) out.controls = await saveControls(db, parsed.data.controls);
    console.info("[admin/ads/platform] saved", { by: gate.user.id, settings: Object.keys(parsed.data.settings ?? {}), controls: Object.keys(parsed.data.controls ?? {}) });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[admin/ads/platform] save failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't save that. Nothing changed." }, { status: 503 });
  }
}

const blockSchema = z.object({ domain: z.string().min(3).max(253), reason: z.string().max(120).optional() }).strict();

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = blockSchema.safeParse(await request.json().catch(() => null));
  const domain = parsed.success ? normalizeBlockedDomain(parsed.data.domain) : null;
  if (!parsed.success || !domain) return NextResponse.json({ error: "Enter a domain like example.com." }, { status: 400 });
  try {
    await addBlockedDomain(createAdminClient(), gate.user.id, domain, parsed.data.reason ?? "");
    console.info("[admin/ads/platform] blocked", { by: gate.user.id, domain });
    return NextResponse.json({ ok: true, domain });
  } catch (e) {
    console.error("[admin/ads/platform] block failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't block that domain." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const domain = normalizeBlockedDomain(new URL(request.url).searchParams.get("domain") ?? "");
  if (!domain) return NextResponse.json({ error: "Invalid domain." }, { status: 400 });
  try {
    await removeBlockedDomain(createAdminClient(), domain);
    console.info("[admin/ads/platform] unblocked", { by: gate.user.id, domain });
    return NextResponse.json({ ok: true, domain });
  } catch (e) {
    console.error("[admin/ads/platform] unblock failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't unblock that domain." }, { status: 503 });
  }
}
