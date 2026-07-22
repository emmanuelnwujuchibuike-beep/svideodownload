import { NextResponse } from "next/server";

import { fetchRecentActivity } from "@/lib/admin/activity";
import { getAdminUser } from "@/lib/admin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only: recent activity, or (with ?since=ISO) only what's newer — for the live feed poll. */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  const items = await fetchRecentActivity(40, since);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
