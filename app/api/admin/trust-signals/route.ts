import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { trustIntelligence } from "@/lib/trust/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — Trust Intelligence™ (Feature 19 · Part 16): accounts with spam, automation or repeat-abuse signals, each flag explained. For review only — nothing acts automatically. */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ flags: await trustIntelligence() }, { headers: { "Cache-Control": "private, no-store" } });
}
