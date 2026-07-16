import { NextResponse } from "next/server";

import { getHomeFeed, type HomeFeedSort } from "@/lib/social/home-feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: HomeFeedSort[] = ["for_you", "following", "recent"];

/** GET /api/home-feed?sort=&offset=&limit=&seed= — rich, paginated dashboard feed. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const sortParam = sp.get("sort") as HomeFeedSort | null;
  const sort: HomeFeedSort = sortParam && SORTS.includes(sortParam) ? sortParam : "for_you";
  const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
  const limit = Math.min(20, Math.max(1, Number(sp.get("limit") ?? 8) || 8));
  // Per-refresh reshuffle token (see rankForYou). Length-capped and stripped to
  // a safe alphabet: it's attacker-controlled and lands in a server-side CACHE
  // KEY, so an unbounded value would let anyone spray unlimited distinct
  // entries into that cache. Truncating can only cost a seed collision — two
  // refreshes sharing an order — never correctness.
  const seed = (sp.get("seed") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || undefined;

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

  const page = await getHomeFeed({ viewerId, sort, offset, limit, seed });
  // Anon feeds are identical for everyone → let the CDN edge (incl. African PoPs)
  // serve them without a function hop; personalized feeds stay private to the browser.
  // `seed` is part of the URL, so it's already part of the edge cache key — two
  // refreshes with different seeds can't collide on one cached arrangement.
  const cacheControl = viewerId
    ? "private, max-age=15, stale-while-revalidate=60"
    : "public, s-maxage=20, stale-while-revalidate=90";
  return NextResponse.json(page, { headers: { "Cache-Control": cacheControl } });
}
