import { NextResponse } from "next/server";

import { relationshipIntelligence } from "@/lib/social/intelligence/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/social/intelligence — the signed-in member's own Relationship
 * Intelligence (Feature 19 · Part 8): stages as words, reconnect nudges,
 * evolution suggestions, moments this week. Takes no subject id: nobody can
 * ask about anyone's relationships but their own.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const intel = await relationshipIntelligence(user.id);
  return NextResponse.json(intel, { headers: { "Cache-Control": "private, no-store" } });
}
