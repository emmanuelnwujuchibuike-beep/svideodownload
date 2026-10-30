import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { listAffiliates, setAffiliate } from "@/lib/rewards/affiliate-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** GET /api/admin/rewards/affiliates — every affiliate account, newest change first, with the commissions paid so far. Admins only. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ affiliates: await listAffiliates() }, { headers: NO_STORE });
}

const schema = z
  .object({
    handle: z.string().trim().max(60).optional(),
    userId: z.string().uuid().optional(),
    status: z.enum(["approved", "revoked"]),
    ratePercent: z.number().min(0).max(50),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => !!v.handle || !!v.userId, { message: "A member is required." });

/**
 * POST /api/admin/rewards/affiliates { handle | userId, status, ratePercent, note? } — approve a member as an affiliate at
 * a rate, change their rate, or revoke them (owner, 2026-10-30: members join through support; the admin turns it on).
 * Approved affiliates are the only members who can cash out AI credits (lib/rewards/affiliate-status.ts).
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  const out = await setAffiliate({ handle: parsed.data.handle, userId: parsed.data.userId, status: parsed.data.status, rateBp: Math.round(parsed.data.ratePercent * 100), adminId: admin.id, note: parsed.data.note || null });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, userId: out.userId }, { headers: NO_STORE });
}
