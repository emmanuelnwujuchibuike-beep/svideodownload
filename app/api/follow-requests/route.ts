import { NextResponse } from "next/server";

import { listFollowRequests } from "@/lib/social/follows";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/follow-requests — the signed-in user's pending follow requests (Feature 19 · Part 3). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ requests: [] });
  const requests = await listFollowRequests(user.id);
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
}
