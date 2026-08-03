import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getAnalyticsSummary, type Range } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/analytics?range=24h|7d|30d — the admin analytics summary. */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = new URL(request.url).searchParams.get("range");
  const range: Range = r === "7d" || r === "30d" ? r : "24h";
  return NextResponse.json(await getAnalyticsSummary(range));
}
