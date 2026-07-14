import { NextResponse } from "next/server";

import { getConversation } from "@/lib/social/messages";
import { getActiveStoryForUser } from "@/lib/social/stories";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/conversations/[id]/story — the other participant's CURRENT active
 * story, for the in-thread "Name · N stories" strip (owner mockup).
 *
 * Exists solely so ConversationRoom can re-check this on mount without a full
 * `router.refresh()` — next.config.ts's `staleTimes.dynamic` (6 hours) means
 * a client-side nav into an already-visited thread serves the Next.js
 * router cache's stale RSC payload, so the initial `otherStoryGroup` prop
 * can be badly out of date (a real owner report: "friends stories still
 * doesn't show"). `router.refresh()` was tried first but empirically broke
 * the typing indicator's shared realtime channel on the SAME page — this
 * narrow, single-purpose endpoint fixes the actual staleness without
 * touching the route or this component's mount lifecycle at all.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const convo = await getConversation(id, user.id);
  if (!convo || convo.type !== "direct" || !convo.other) return NextResponse.json({ storyGroup: null });

  const storyGroup = await getActiveStoryForUser(convo.other.id, user.id).catch(() => null);
  return NextResponse.json({ storyGroup });
}
