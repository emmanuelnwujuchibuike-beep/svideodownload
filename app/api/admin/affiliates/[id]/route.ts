import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { affiliateUpdateSchema } from "@/lib/monetization/affiliate-schema";
import { clearAffiliateCache } from "@/lib/monetization/tools";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/admin/affiliates/:id — update fields (incl. enable + reorder). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = affiliateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update." },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const db = createAdminClient();
    const { error } = await db.from("affiliate_offers").update(parsed.data).eq("id", id);
    if (error) throw error;
    clearAffiliateCache();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't update affiliate." }, { status: 500 });
  }
}

/** DELETE /api/admin/affiliates/:id — remove an affiliate/tool. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  try {
    const db = createAdminClient();
    const { error } = await db.from("affiliate_offers").delete().eq("id", id);
    if (error) throw error;
    clearAffiliateCache();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't delete affiliate." }, { status: 500 });
  }
}
