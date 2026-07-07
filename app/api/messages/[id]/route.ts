import { NextResponse } from "next/server";

import { getConversation } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/messages/[id] — the full thread for a participant (also marks the
 * other side's messages read, same as opening the page). This is the catch-up
 * path that makes chat truly realtime in practice: `postgres_changes` has no
 * replay, so anything sent while the socket was suspended (backgrounded phone,
 * flaky network) is silently lost — the room refetches here on resume/reconnect
 * and merges, so users never have to refresh to see missed messages.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const view = await getConversation(id, user.id);
  if (!view) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json(
    { messages: view.messages },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
