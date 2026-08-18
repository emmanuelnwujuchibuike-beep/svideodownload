import { NextResponse } from "next/server";

import { shareCircleScores } from "@/lib/social/share-circle";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/share/circle — Smart Share Circle™: relationship-strength scores
 * (see lib/social/share-circle.ts) for the viewer's own friends, keyed by
 * user id. `loadPeople()` (features/social/people-picker.tsx) merges these
 * into its existing recent-conversations + friends list rather than this
 * route returning full profiles itself — the profiles already come from
 * `/api/messages`/`/api/friends`, this only adds the missing ranking signal.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ scores: {} });

  const scores = await shareCircleScores(user.id);
  return NextResponse.json({ scores }, { headers: { "Cache-Control": "private, no-store" } });
}
