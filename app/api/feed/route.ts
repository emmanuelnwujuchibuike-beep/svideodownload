import { after, NextResponse } from "next/server";

import { maybeSweepScheduledPosts } from "@/lib/creator/schedule";
import { isCategory } from "@/lib/social/categories";
import { getFeed, type FeedSort } from "@/lib/social/feed";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed?sort=trending|recent&category=… — public discovery feed. */
export async function GET(request: Request) {
  /*
    Scheduled publishing rides real traffic (Feature 15 Part 9).

    Vercel gives this project two cron slots and both are taken, so a scheduled
    post cannot wait for a schedule of its own — a daily sweep would publish a
    14:00 post at 03:00 the next morning. `maybeSweepScheduledPosts` is guarded
    by a 60-second lock, so this costs one cheap Redis read on the vast
    majority of requests and does a sweep at most once a minute site-wide.

    `after()`, never awaited: the feed response must not wait on it, and a bare
    fire-and-forget promise is not guaranteed to run to completion before a
    serverless function freezes — the lesson from the push-latency incident.
  */
  after(() => maybeSweepScheduledPosts());

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
