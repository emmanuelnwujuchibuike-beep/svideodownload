import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { fetchMemberActivity, fetchSignedInUsers } from "@/lib/admin/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/people — who is signed in, and what one member is doing.
 *
 *   ?hours=24            the roster over that window (default 24, max 720)
 *   ?user=<uuid>&hours=  that member's detailed activity, newest first
 *
 * Owner, 2026-09-27: "Make a place in admin dashboard where I can see all
 * signed in users and detailed activities."
 *
 * ── Two shapes, one route, on purpose ───────────────────────────────────────
 *
 * The detail read is the roster read's drill-down and is never wanted at the
 * same time, so a second route would be a second admin guard, a second
 * `getAdminUser()` round trip and a second thing to keep in step. The roster
 * polls; the detail is fetched once when a row is opened.
 *
 * ── Admin-gated, service-role backed ────────────────────────────────────────
 *
 * `getAdminUser()` is the same guard every other admin route uses, and the
 * reads underneath go through the service role. The browser never touches
 * `analytics_events` directly — migration 0172's SELECT policy admits admins
 * so that the per-section Realtime subscriptions can work, but a full roster
 * aggregate is server work and stays there.
 *
 * `no-store`: this is a live operational view, and next.config's wide API rule
 * stamps the same thing. Cloudflare has served one person's admin answer to
 * another for two hours on this project before, on a route that named no
 * caching policy of its own.
 */
export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const hoursRaw = Number(params.get("hours"));
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : undefined;
  const user = params.get("user");

  if (user) {
    // A malformed id would otherwise reach PostgREST and come back as a 400
    // that reads like a server fault rather than a bad link.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user)) {
      return NextResponse.json({ error: "Bad user id" }, { status: 400 });
    }
    const detail = await fetchMemberActivity(user, hours);
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  }

  const roster = await fetchSignedInUsers(hours);
  return NextResponse.json(roster, { headers: { "Cache-Control": "no-store" } });
}
