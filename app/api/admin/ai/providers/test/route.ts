import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { testProvider } from "@/lib/ai/providers/test";
import { getLandingSettings } from "@/lib/landing/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  feature: z.enum(["character_replace", "lip_sync", "text_to_speech", "voice_change"]),
  vendor: z.enum(["replicate", "fal", "elevenlabs"]),
});

/**
 * POST /api/admin/ai/providers/test — the fal.ai brief §27. Admin-only:
 * validates one vendor's credentials and model configuration for one
 * feature, records a TEST run, answers a sentence. Submits nothing to a model
 * and touches no member's credits. The vendor named here is which TILE the
 * operator pressed; routing decisions never read a request value.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a feature and a provider." }, { status: 400 });
  const settings = await getLandingSettings();
  const result = await testProvider(parsed.data.feature, parsed.data.vendor, settings, admin.id);
  return NextResponse.json(result);
}
