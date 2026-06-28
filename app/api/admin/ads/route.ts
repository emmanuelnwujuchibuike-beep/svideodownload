import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adCreateSchema } from "@/lib/monetization/ad-schema";
import { clearAdCache, listAds } from "@/lib/monetization/ads";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/ads — every ad placement (admin only). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ads: await listAds() });
}

/** POST /api/admin/ads — create an ad placement. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = adCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid ad." },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ads")
      .insert({
        zone: parsed.data.zone,
        network: parsed.data.network,
        format: parsed.data.format,
        script_code: parsed.data.script_code ?? null,
        image_url: parsed.data.image_url ?? null,
        target_url: parsed.data.target_url ?? null,
        headline: parsed.data.headline ?? null,
        width: parsed.data.width ?? null,
        height: parsed.data.height ?? null,
        priority: parsed.data.priority ?? 100,
        weight: parsed.data.weight ?? 1,
        active: parsed.data.active ?? true,
      })
      .select("id")
      .single();
    if (error) throw error;
    clearAdCache();
    return NextResponse.json({ ok: true, id: data.id });
  } catch {
    return NextResponse.json({ error: "Couldn't create ad." }, { status: 500 });
  }
}
