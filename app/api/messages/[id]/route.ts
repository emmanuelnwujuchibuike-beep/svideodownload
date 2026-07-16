import { NextResponse } from "next/server";

import { getConversation } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/messages/[id] — the thread for a participant (also marks the
 * other side's messages read, same as opening the page). This is the catch-up
 * path that makes chat truly realtime in practice: `postgres_changes` has no
 * replay, so anything sent while the socket was suspended (backgrounded phone,
 * flaky network) is silently lost — the room refetches here on resume/reconnect
 * and merges, so users never have to refresh to see missed messages.
 *
 * `?since=<ISO timestamp>` (the previous response's own `syncedAt`) turns
 * this into a DELTA sync — only messages that changed after that moment come
 * back, instead of the full last-300 window. The client already holds
 * everything older, so this is the same catch-up guarantee at a fraction of
 * the payload once a thread has any real history.
 *
 * `?peek=1` reads the thread WITHOUT marking anything read — for the inbox
 * warm-up, which pre-loads each chat so opening it is instant. Without this,
 * warming would mark every conversation read just from opening the inbox and
 * show the sender a false "Seen" (the exact bug that got the previous warm-up
 * deleted). Read-marking stays the DEFAULT so nothing else changes behaviour.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const sinceUpdatedAt = since && !Number.isNaN(Date.parse(since)) ? since : undefined;
  const peek = url.searchParams.get("peek") === "1";

  const view = await getConversation(id, user.id, sinceUpdatedAt, { peek });
  if (!view) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json(
    { messages: view.messages, syncedAt: view.syncedAt },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
