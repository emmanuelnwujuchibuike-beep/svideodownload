import { NextResponse } from "next/server";

import { isPeriod, type AnalyticsPeriod } from "@/lib/creator-analytics/format";
import { getAICreations, getAudience, getExclusive, getFeatureOfMonth, getGifting, getOverview, getPostInsights, getPosts, getSocial, getViews, POST_SORTS, type PostSort } from "@/lib/creator-analytics/server";
import { getUserPlan } from "@/lib/monetization/plan";
import { trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/**
 * GET /api/creator-analytics/:section — the rebuilt Creator analytics, one section per call (lib/creator-analytics).
 * The creator is ALWAYS the session (Business plan, as the page); nothing a client sends names another creator.
 * `period` 7d | 30d | 90d | 1y, `tz` an IANA zone (checked again in the database), plus `sort`/`page`/`q` for posts
 * and `id` for one post. Private, never cached by a CDN; the screens cache per period in the browser.
 */
export async function GET(request: Request, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { success } = await trackLimiter.limit(`creator-analytics:${user.id}`);
  if (!success) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });
  if ((await getUserPlan(user.id)) !== "business") return NextResponse.json({ error: "Creator analytics is part of the Business plan." }, { status: 403 });

  const url = new URL(request.url);
  const p = url.searchParams.get("period");
  const period: AnalyticsPeriod = isPeriod(p) ? p : "30d";
  const tzRaw = url.searchParams.get("tz") ?? "UTC";
  const tz = TZ.test(tzRaw) && tzRaw.length <= 64 ? tzRaw : "UTC";
  const headers = { "Cache-Control": "private, no-store" };

  let data: unknown = null;
  switch (section) {
    case "overview":
      data = await getOverview(user.id, period, tz);
      break;
    case "social":
      data = await getSocial(user.id, period, tz);
      break;
    case "views":
      data = await getViews(user.id, period, tz);
      break;
    case "audience":
      data = await getAudience(user.id, tz);
      break;
    case "exclusive":
      data = await getExclusive(user.id, period);
      break;
    case "gifting":
      data = await getGifting(user.id, period);
      break;
    case "posts": {
      const s = url.searchParams.get("sort");
      const sort: PostSort = POST_SORTS.includes(s as PostSort) ? (s as PostSort) : "views";
      const page = Math.max(0, Math.min(500, Math.floor(Number(url.searchParams.get("page") ?? 0)) || 0));
      data = await getPosts(user.id, sort, page, (url.searchParams.get("q") ?? "").slice(0, 80));
      break;
    }
    case "post": {
      const id = url.searchParams.get("id") ?? "";
      if (!UUID.test(id)) return NextResponse.json({ error: "Invalid post." }, { status: 400, headers });
      data = await getPostInsights(user.id, id);
      if (!data) return NextResponse.json({ error: "That post isn't yours or doesn't exist." }, { status: 404, headers });
      break;
    }
    case "ai":
      data = await getAICreations(user.id, period);
      break;
    case "feature":
      data = await getFeatureOfMonth(user.id);
      break;
    default:
      return NextResponse.json({ error: "Unknown section." }, { status: 404, headers });
  }
  if (data === null) return NextResponse.json({ error: "These analytics aren't available yet." }, { status: 503, headers });
  return NextResponse.json(data, { headers });
}
