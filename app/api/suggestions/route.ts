import { NextResponse } from "next/server";

import { getSuggestedCreators } from "@/lib/social/suggest";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/suggestions — "people you may know" for the Add-friends launcher. */
export async function GET() {
  let viewerId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewerId = user?.id ?? null;
  } catch {
    /* anon */
  }
  const suggestions = await getSuggestedCreators(viewerId, 12);
  return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } });
}
