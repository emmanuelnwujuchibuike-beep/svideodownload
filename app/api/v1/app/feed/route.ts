import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { noStore, publicCache } from "@/lib/api/edge-cache";
import { clampLimit, decodeCursor, encodeCursor, fail, ok } from "@/lib/api/respond";
import { getHomeFeed, type HomeFeedSort } from "@/lib/social/home-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: HomeFeedSort[] = ["for_you", "following", "recent"];

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/v1/app/feed?cursor=&limit=&sort= — the cursor-paginated home feed,
 * shared by every client for infinite scroll. The cursor is opaque (see
 * respond.ts) so the storage strategy can change without breaking clients.
 *
 * Auth is optional: signed-in users get personalized like/save/follow state;
 * anonymous callers get the public feed. This lets clients paint the feed
 * immediately and hydrate personalization once the session resolves.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sortParam = url.searchParams.get("sort") as HomeFeedSort | null;
  const sort: HomeFeedSort = sortParam && SORTS.includes(sortParam) ? sortParam : "for_you";
  const limit = clampLimit(url.searchParams.get("limit"), 12, 30);
  const offset = decodeCursor(url.searchParams.get("cursor"));

  const user = await getSessionUser(request);
  if (sort === "following" && !user) {
    return fail("unauthorized", "Sign in to see your following feed.");
  }

  try {
    const page = await getHomeFeed({ viewerId: user?.id ?? null, sort, offset, limit });
    const res = ok(
      { items: page.items, sort },
      { nextCursor: page.nextOffset === null ? null : encodeCursor(page.nextOffset) },
    );
    // Anonymous "for_you"/"recent" is identical for everyone → cache at the edge.
    // Anything personalized (signed-in, or the following feed) is never cached.
    return user ? noStore(res) : publicCache(res, { sMaxAge: 30, swr: 120 });
  } catch {
    return fail("upstream_error", "Couldn't load the feed right now.");
  }
}
