import { NextResponse } from "next/server";

import { isCategory } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed?sort=trending|recent&category=… — public discovery feed. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const sort: FeedSort = sp.get("sort") === "recent" ? "recent" : "trending";
  const categoryParam = sp.get("category");
  const category = categoryParam && isCategory(categoryParam) ? categoryParam : null;

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
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "private, max-age=30" } });
}
