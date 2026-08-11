import { NextResponse } from "next/server";

import { getRequestUser } from "@/lib/auth/request-user";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { isAttributionEvent, recordAttributions, type AttributionInput } from "@/lib/social/repost/attribution";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One request carries a page's worth of events, never a session's. */
const MAX_EVENTS = 20;

/**
 * POST /api/reposts/attribution — record what a repost caused.
 *
 * The client batches: a feed page's impressions go up in one request when the
 * page unloads or the tab hides, rather than one fetch per card. "Minimal
 * network requests" from the brief is a batching decision, not a compression
 * one.
 *
 * ── The actor is the SESSION, never the body ─────────────────────────────
 * A client that could name the actor could attribute reach to anyone. The body
 * carries only which repost and which event; who did it is whoever is signed
 * in, or nobody.
 *
 * ── A member's own actions on their own repost are not reach ─────────────
 * Filtered here, because otherwise every repost would open with one guaranteed
 * impression — of itself — and every reach figure in the product would start at
 * 1. That is a small lie that makes every other number less believable.
 */
export async function POST(request: Request) {
  const limit = await trackLimiter.limit(clientId(request.headers));
  if (!limit.success) return NextResponse.json({ ok: true, skipped: true }, { status: 202 });

  let body: { events?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!Array.isArray(body.events)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const user = await getRequestUser(request);
  const actorId = user?.id ?? null;

  const parsed: AttributionInput[] = [];
  const seen = new Set<string>();
  for (const raw of body.events.slice(0, MAX_EVENTS)) {
    const e = raw as { repostId?: unknown; postId?: unknown; event?: unknown };
    if (typeof e.repostId !== "string" || !UUID.test(e.repostId)) continue;
    if (typeof e.postId !== "string" || !UUID.test(e.postId)) continue;
    if (!isAttributionEvent(e.event)) continue;
    // De-dupe within the batch too: the unique index would reject the second
    // one anyway, and `ignoreDuplicates` would then quietly drop it — cheaper
    // to not send it.
    const key = `${e.repostId}:${e.event}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ repostId: e.repostId, postId: e.postId, actorId, event: e.event });
  }
  if (parsed.length === 0) return NextResponse.json({ ok: true, recorded: 0 });

  const filtered = actorId ? await dropOwnReposts(parsed, actorId) : parsed;
  await recordAttributions(filtered);
  return NextResponse.json({ ok: true, recorded: filtered.length });
}

/** Drop events where the actor is the reposter. One query for the whole batch. */
async function dropOwnReposts(events: AttributionInput[], actorId: string): Promise<AttributionInput[]> {
  try {
    const { data } = await createAdminClient()
      .from("reposts")
      .select("id")
      .eq("user_id", actorId)
      .in("id", [...new Set(events.map((e) => e.repostId))]);
    const own = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    return own.size === 0 ? events : events.filter((e) => !own.has(e.repostId));
  } catch {
    // Unreadable: record nothing rather than risk self-inflated reach. This is
    // telemetry — losing a batch costs a number, keeping a wrong one costs trust.
    return [];
  }
}
