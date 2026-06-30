import type { NextResponse } from "next/server";

/**
 * Edge/CDN cache-control helpers for API responses.
 *
 * Vercel (and any CDN in front of it) honours `s-maxage` + `stale-while-
 * revalidate`: the first request fills the edge cache, subsequent requests are
 * served from the edge for `sMaxAge` seconds, and for a further `swr` seconds the
 * stale copy is served instantly while the edge refreshes in the background. The
 * browser is told not to cache (`max-age=0`) so users still get fresh-ish data,
 * while the shared edge absorbs the load — this is how public feeds scale to
 * millions without hammering the origin.
 *
 * ONLY use `publicCache` for responses that are identical for every viewer
 * (anonymous feed, trending, news, public profiles). Anything personalized must
 * use `noStore` so one user's data is never served to another from the edge.
 */
export function publicCache(res: NextResponse, opts: { sMaxAge?: number; swr?: number } = {}): NextResponse {
  const sMaxAge = opts.sMaxAge ?? 30;
  const swr = opts.swr ?? 120;
  res.headers.set("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
  return res;
}

/** Never cache (personalized or sensitive responses). */
export function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
