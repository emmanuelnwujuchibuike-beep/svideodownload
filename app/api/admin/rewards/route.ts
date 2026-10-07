import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { loadRewardsAdmin } from "@/lib/rewards/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/rewards — referral analytics and the withdrawal queue, fetched only when the Rewards tab is opened (lib/rewards/admin.ts). */
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await loadRewardsAdmin(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/rewards] load failed", { error: String(e).slice(0, 200) });
    return NextResponse.json({ error: "Couldn't load rewards." }, { status: 503 });
  }
}
