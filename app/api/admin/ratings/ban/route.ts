import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { banRater, unbanRater } from "@/lib/security/rating-bans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ratings/ban — ban the person behind an app rating; DELETE lifts it (0267, 2026-10-22).
 * Admin-gated by `getAdminUser()`, like every admin route. See lib/security/rating-bans.ts.
 */
const banSchema = z.object({ ratingId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).strict();
const liftSchema = z.object({ ratingId: z.string().uuid() }).strict();

const noStore = { "Cache-Control": "private, no-store" };

async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = banSchema.safeParse(await body(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const res = await banRater(parsed.data.ratingId, admin.id, parsed.data.reason || null);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = liftSchema.safeParse(await body(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const res = await unbanRater(parsed.data.ratingId, admin.id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
