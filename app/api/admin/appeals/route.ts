import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { listPendingAppeals, resolveAppeal } from "@/lib/social/appeals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  appealId: z.string().uuid(),
  resolution: z.enum(["upheld", "overturned"]),
  adminNote: z.string().trim().max(500).optional(),
});

/** GET — the pending appeals queue. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ appeals: await listPendingAppeals() });
}

/** POST — resolve an appeal (uphold the original action, or overturn it). */
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
  if (!parsed.success) return NextResponse.json({ error: "Invalid resolution." }, { status: 400 });

  const res = await resolveAppeal(parsed.data.appealId, admin.id, parsed.data.resolution, parsed.data.adminNote ?? null);
  if (!res.ok) return NextResponse.json({ error: "Couldn't resolve that appeal." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
