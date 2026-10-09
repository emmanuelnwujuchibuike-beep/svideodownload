import { NextResponse } from "next/server";
import { z } from "zod";

import { ADVERTISER_STATUSES, listAdvertisers, setAdvertiserStatus } from "@/lib/ads-platform/admin-campaigns";
import { requireAdminApi } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/ads/advertisers — Ad Platform Part 7.
 *
 * GET  ?q=                         advertisers with campaign counts
 * POST { id, status, reason }      active · restricted · suspended · disabled.
 *                                  Anything but active pauses their live ads at
 *                                  once (admin_set_advertiser_status, 0204).
 */
export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  try {
    const rows = await listAdvertisers(createAdminClient(), new URL(request.url).searchParams.get("q") ?? undefined);
    return NextResponse.json({ advertisers: rows }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ads/advertisers] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load advertisers." }, { status: 503 });
  }
}

const schema = z
  .object({ id: z.string().uuid(), status: z.enum(ADVERTISER_STATUSES), reason: z.string().trim().max(300).nullable().optional() })
  .strict();

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const out = await setAdvertiserStatus(createAdminClient(), gate.user.id, { id: parsed.data.id, status: parsed.data.status, reason: parsed.data.reason || null });
    console.info("[admin/ads/advertisers] status", { by: gate.user.id, id: parsed.data.id, status: parsed.data.status, ok: out.ok, paused: out.paused });
    return NextResponse.json(out, { status: out.ok ? 200 : 409 });
  } catch (e) {
    console.error("[admin/ads/advertisers] save failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't save that. Nothing changed." }, { status: 503 });
  }
}
