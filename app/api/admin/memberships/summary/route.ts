import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { adminSummary } from "@/lib/sub/admin-reporting";
import { isPeriod } from "@/lib/sub/earnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?days=7|30|90 — the Exclusive subscription overview for admins (Part 7). Aggregated in the database (0252). */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  if (!isPeriod(days)) return NextResponse.json({ error: "Choose 7, 30 or 90 days." }, { status: 400 });
  const out = await adminSummary(days);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out.summary, { headers: { "Cache-Control": "private, no-store" } });
}
