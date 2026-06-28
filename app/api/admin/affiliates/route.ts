import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { affiliateCreateSchema } from "@/lib/monetization/affiliate-schema";
import { clearAffiliateCache, listAffiliates } from "@/lib/monetization/tools";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/affiliates — every affiliate/tool row (admin only). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ affiliates: await listAffiliates() });
}

/** POST /api/admin/affiliates — create a new affiliate/tool. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = affiliateCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid affiliate." },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("affiliate_offers")
      .insert({
        name: parsed.data.name,
        url: parsed.data.url,
        description: parsed.data.description ?? null,
        image_url: parsed.data.image_url ?? null,
        cta: parsed.data.cta || "Visit",
        category: parsed.data.category ?? null,
        placements: parsed.data.placements ?? [],
        priority: parsed.data.priority ?? 100,
        sort_order: parsed.data.sort_order ?? 100,
        weight: parsed.data.weight ?? 1,
        active: parsed.data.active ?? true,
        starts_at: parsed.data.starts_at ?? null,
        ends_at: parsed.data.ends_at ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    clearAffiliateCache();
    return NextResponse.json({ ok: true, id: data.id });
  } catch {
    return NextResponse.json({ error: "Couldn't create affiliate." }, { status: 500 });
  }
}
