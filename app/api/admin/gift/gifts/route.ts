import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFinancialAdmin } from "@/lib/admin/financial-gate";
import { getAdminUser } from "@/lib/admin/guard";
import { listPendingGifts, reverseGift } from "@/lib/gift/gifts-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ giftId: z.string().uuid(), reason: z.string().max(400) }).strict();

/** GET /api/admin/gift/gifts — gifts whose earnings are still pending (those past their hold first). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = await listPendingGifts();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ gifts: r.gifts }, { headers: { "cache-control": "no-store" } });
}

/**
 * POST /api/admin/gift/gifts — reverse a PENDING gift (a chargeback decision): the recipient's pending share is taken
 * back, the sender is refunded the price in FGC, the commission income is reversed. A fresh password; audited by
 * reverse_gift. A released gift is never reversed here.
 */
export async function POST(request: Request) {
  const gate = await requireFinancialAdmin("gift.reverse", null);
  if (!gate.ok) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await reverseGift({ giftId: parsed.data.giftId, adminId: gate.user.id, reason: parsed.data.reason });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
