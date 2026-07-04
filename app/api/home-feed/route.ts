import { NextResponse } from "next/server";

import { getHomeFeed, type HomeFeedSort } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: HomeFeedSort[] = ["for_you", "following", "recent"];

/** GET /api/home-feed?sort=&offset=&limit= — rich, paginated dashboard feed. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const sortParam = sp.get("sort") as HomeFeedSort | null;
  const sort: HomeFeedSort = sortParam && SORTS.includes(sortParam) ? sortParam : "for_you";
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(20, Math.max(1, Number(sp.get("limit") ?? 8) || 8));

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

  const page = await getHomeFeed({ viewerId, sort, offset, limit });
  // Anon feeds are identical for everyone → let the CDN edge (incl. African PoPs)
  // serve them without a function hop; personalized feeds stay private to the browser.
  const cacheControl = viewerId
    ? "private, max-age=15, stale-while-revalidate=60"
    : "public, s-maxage=20, stale-while-revalidate=90";
  return NextResponse.json(page, { headers: { "Cache-Control": cacheControl } });
}
