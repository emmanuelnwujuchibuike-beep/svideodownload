import { NextResponse } from "next/server";

import { AFFILIATE_ONLY_MESSAGE } from "@/lib/rewards/affiliate-status";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rewards/qualification — the member used to apply here for withdrawal approval (0191).
 *
 * 🔴 CLOSED (owner, 2026-10-30): "comment out (hide) all AI credit and qualifications withdrawal … they only contact
 * support to join the affiliate AI earnings". Cashing out AI credits is now for approved affiliates only, approved by an
 * admin (lib/rewards/affiliate-status.ts); nobody applies from the app. The application logic stays in
 * lib/rewards/qualification.ts (applyForQualification) so it can be switched back on — this route no longer calls it.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.json({ error: AFFILIATE_ONLY_MESSAGE }, { status: 410 });
}
