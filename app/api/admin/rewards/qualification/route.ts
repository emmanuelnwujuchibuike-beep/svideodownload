import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { reviewQualification } from "@/lib/rewards/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ userId: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(300).optional() }).strict();

/** POST /api/admin/rewards/qualification — approve or reject a member's withdrawal application (0191). Admins only; only an application that is waiting can be decided. */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const out = await reviewQualification({ userId: parsed.data.userId, approve: parsed.data.approve, adminId: admin.id, note: parsed.data.note || null });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
}
