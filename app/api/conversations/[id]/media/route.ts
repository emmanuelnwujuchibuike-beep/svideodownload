import { NextResponse } from "next/server";

import { MEDIA_TABS, listConversationMedia, type MediaTab } from "@/lib/social/conversation-media";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/conversations/[id]/media?tab=media|links|files&before=<iso> — the chat options sheet's
 * "Media, links & files" (lib/social/conversation-media.ts). A non-member gets the same 404 a missing
 * chat does, so the answer never confirms a chat exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to see this chat." }, { status: 401 });

  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") ?? "media") as MediaTab;
  if (!MEDIA_TABS.includes(tab)) return NextResponse.json({ error: "Unknown tab." }, { status: 400 });
  const before = url.searchParams.get("before");
  if (before && Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "Bad cursor." }, { status: 400 });

  try {
    const page = await listConversationMedia(id, user.id, tab, before);
    if (!page) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load this right now." }, { status: 503 });
  }
}
