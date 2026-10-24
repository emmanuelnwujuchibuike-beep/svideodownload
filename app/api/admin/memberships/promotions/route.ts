import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { adminCreatorPromotions, adminPausePromotion } from "@/lib/sub/promotions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET ?creator=@handle|id — Admin → Memberships: one creator's bundle prices, promotions (status, redemptions, live
 * count, limit) and the verified purchases that used them (0277).
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const out = await adminCreatorPromotions(new URL(request.url).searchParams.get("creator") ?? "");
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ creator: out.creator }, { headers: { "Cache-Control": "private, no-store" } });
}

const body = z.object({ id: z.string().uuid(), note: z.string().min(3).max(300) }).strict();

/** POST — pause a promotion (moderation). Only the team lifts an admin's pause. Logged with the admin's id and reason. */
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give a reason of at least 3 characters." }, { status: 400 });
  const out = await adminPausePromotion(admin.id, parsed.data.id, parsed.data.note);
  console.info("[admin/sub] promotion pause", { admin: admin.id, id: parsed.data.id, ok: out.ok });
  return out.ok ? NextResponse.json(out) : NextResponse.json({ error: out.error }, { status: out.status });
}
