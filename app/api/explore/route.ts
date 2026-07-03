import { NextResponse } from "next/server";

import { isCategory } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/explore?sort=&category= — the discovery feed for a sort/category,
 * powering the instant client-side Explore tabs (no page reload on switch).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sort: FeedSort = url.searchParams.get("sort") === "recent" ? "recent" : "trending";
  const cat = url.searchParams.get("category");
  const category = cat && isCategory(cat) ? cat : null;

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

  const posts = await getFeed({ sort, category, viewerId });
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "private, no-store" } });
}
