import { NextResponse } from "next/server";

import { getFeedItemById } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/posts/:id/feed-item — the FULL `FeedItem` shape (not the compact
 * chat-embed preview `GET /api/posts/:id` returns) so a grid tile (Explore/
 * Profile/Search/Saved — components/social/post-grid.tsx) can open the SAME
 * instant client-side viewer the Home feed uses (ImageViewer/ReelsFeed/
 * PostViewer) instead of navigating to `/p/[id]` — owner: "the images in
 * feed enters another page before opening, i want it to open instantly."
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const item = await getFeedItemById(id, user?.id ?? null);
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ item }, { headers: { "Cache-Control": "private, no-store" } });
}
