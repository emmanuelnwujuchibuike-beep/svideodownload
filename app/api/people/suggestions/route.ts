import { NextResponse } from "next/server";

import { isSuggestionFilter } from "@/lib/social/graph/suggestions";
import { peopleYouMayKnow } from "@/lib/social/people/engine";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/people/suggestions?filter=all|mutual|creators|… — People You May Know (Feature 19 · Part 6). Every person comes with the reason. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ people: [] }, { status: 401 });
  const url = new URL(req.url);
  const f = url.searchParams.get("filter");
  const people = await peopleYouMayKnow(user.id, {
    filter: isSuggestionFilter(f) ? f : "all",
    limit: Number(url.searchParams.get("limit")) || 24,
    userClient: supabase,
  });
  return NextResponse.json({ people }, { headers: { "Cache-Control": "private, no-store" } });
}
