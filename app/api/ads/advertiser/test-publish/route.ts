import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/admin/require-admin";
import { adminTestPublish } from "@/lib/ads-platform/admin-test-publish";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ campaignId: z.string().uuid() }).strict();

const ERR: Record<string, string> = {
  not_found: "That campaign doesn't exist.",
  not_your_campaign: "Test publishing only works on your own campaigns.",
  already_paid: "This campaign is already paid.",
  not_submitted: "Review the campaign first, then publish it as a test.",
  changed: "The campaign changed — reload and try again.",
};

/**
 * POST /api/ads/advertiser/test-publish — ADMINS ONLY: publish your own
 * submitted campaign without a payment, for testing. Recorded at amount 0 with
 * an `admin-test:` reference, audited, never counted as revenue
 * (lib/ads-platform/admin-campaigns.ts adminTestPublish). Anyone else gets 404.
 */
export async function POST(req: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await adminTestPublish(createAdminClient(), gate.user.id, parsed.data.campaignId);
  console.info("[ads/test-publish]", { by: gate.user.id, campaign: parsed.data.campaignId, ok: out.ok, reason: out.reason, status: out.status });
  if (!out.ok) return NextResponse.json({ error: ERR[out.reason ?? ""] ?? "Couldn't publish the test.", reason: out.reason }, { status: 409 });
  return NextResponse.json({ ok: true, status: out.status, note: out.reason ?? null }, { headers: { "cache-control": "no-store" } });
}
