import { NextResponse } from "next/server";

import { listStarredMessages } from "@/lib/social/message-search";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/messages/starred — everything the signed-in user has starred (Part 10). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] }, { status: 401 });

  const items = await listStarredMessages(user.id);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
