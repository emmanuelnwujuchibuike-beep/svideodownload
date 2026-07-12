import { NextResponse } from "next/server";

import { trackLimiter } from "@/lib/rate-limit";
import { searchMessages } from "@/lib/social/message-search";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/messages/search?q=&conversationId= — Part 10 message search.
 * `q` is required; `conversationId` narrows to one thread (search within
 * this chat) instead of everywhere.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  const { success } = await trackLimiter.limit(`msg-search:${user.id}`);
  if (!success) return NextResponse.json({ results: [] }, { status: 429 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ results: [] });
  const conversationId = url.searchParams.get("conversationId");
  const scopedId = conversationId && UUID.test(conversationId) ? conversationId : undefined;

  const results = await searchMessages(user.id, q, scopedId);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
