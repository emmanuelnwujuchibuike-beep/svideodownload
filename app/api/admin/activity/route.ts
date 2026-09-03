import { NextResponse } from "next/server";

import { fetchRecentActivity } from "@/lib/admin/activity";
import { isActivityCategory, kindsInCategory } from "@/lib/admin/activity-categories";
import { getAdminUser } from "@/lib/admin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far back a category tab looks — the owner's window: "the last 24hrs". */
const CATEGORY_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Row ceiling for a category view. Generous, because the whole point is that an
 * install is no longer buried behind two hundred ad impressions — but bounded,
 * because this is one admin request and not a data export.
 */
const CATEGORY_LIMIT = 300;

/**
 * Admin-only recent activity.
 *
 *   (no params)          the live feed's first page
 *   ?since=ISO           only what is newer — the live poll's incremental cursor
 *   ?category=ads        that category alone, over the last 24 hours
 *
 * ── The category read is ONE-SHOT, deliberately ───────────────────────────────
 *
 * Owner, 2026-09-03: "separate the ad stat from download … in a top nav that
 * when click on install shows all recent install in the last 24hrs."
 *
 * A tab fetches once when it is opened and the client keeps the result. It is
 * NOT wired to the live scheduler, because a 24-hour window does not change
 * meaningfully in fifteen seconds and this dashboard has already cost the owner
 * real money once — the 2.5s poll that ate $15 of a $20 credit, and the SSE
 * route before it. The live tab keeps polling; the historical tabs do not.
 *
 * A category also makes the query smaller, not larger: it narrows the event
 * types, and a category with no downloads in it skips the downloads table
 * entirely.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const rawCategory = params.get("category");

  if (rawCategory && rawCategory !== "all") {
    // Unknown category ⇒ 400 rather than silently serving the whole feed, which
    // would look like the tab working while showing another tab's rows.
    if (!isActivityCategory(rawCategory)) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }
    const kinds = kindsInCategory(rawCategory);
    const since = new Date(Date.now() - CATEGORY_WINDOW_MS).toISOString();
    const items = await fetchRecentActivity(CATEGORY_LIMIT, since, kinds);
    return NextResponse.json(
      { items, category: rawCategory, windowHours: CATEGORY_WINDOW_MS / 3_600_000 },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const since = params.get("since") ?? undefined;
  const items = await fetchRecentActivity(40, since);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
