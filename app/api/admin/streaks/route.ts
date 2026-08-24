import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getStreakMetrics } from "@/lib/streaks/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/streaks — streak monitoring for the admin dashboard (§21).
 *
 * Guarded by the same `getAdminUser()` every other admin route here uses, so
 * there is one definition of "is an admin" rather than a second one for this
 * feature. Read-only: the kill switches live in the flag system, not here.
 */
export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getStreakMetrics(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
