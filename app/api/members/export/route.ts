import { NextResponse } from "next/server";

import { exportMembers } from "@/lib/creator/membership/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the creator's own member list as CSV (handle, name, role, tier, status, joined, country). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const csv = await exportMembers(user.id);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="frenz-members.csv"', "Cache-Control": "private, no-store" } });
}
