import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { getAnalyticsSummary, setCpmUsd, type Range } from "@/lib/analytics/queries";

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

/** POST /api/admin/analytics — save dashboard settings (currently the revenue CPM). */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { cpmUsd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const cpm = Number(body.cpmUsd);
  if (!Number.isFinite(cpm) || cpm < 0 || cpm > 1000) {
    return NextResponse.json({ error: "cpmUsd must be between 0 and 1000" }, { status: 400 });
  }
  await setCpmUsd(Math.round(cpm * 100) / 100);
  return NextResponse.json({ ok: true, cpmUsd: Math.round(cpm * 100) / 100 });
}
