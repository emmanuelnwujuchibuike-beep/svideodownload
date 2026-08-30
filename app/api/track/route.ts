import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdClick, recordAdImpression } from "@/lib/analytics/events";
import { emit } from "@/lib/platform/event-bus";
import { AD_ZONES } from "@/lib/monetization/ad-schema";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Derived from the one registry, never re-listed here.

  This was a hand-maintained copy and it did not include any placement added
  after it was written. The failure was completely silent and specifically
  destroys the numbers this endpoint exists to produce: the beacon is sent with
  `navigator.sendBeacon`, which never surfaces a response, so a rejected zone
  looks exactly like a recorded one from the page's side. Every impression and
  click on a new placement would have been dropped, and the admin dashboard
  would have shown a confident zero.
*/
const schema = z.object({
  kind: z.enum(["impression", "click"]),
  zone: z.enum(AD_ZONES),
  /*
    🔴 NOT `.uuid()` any more (2026-08-30).

    Shared-mode ExoClick slots have no ad ROW, so they carry a synthetic id
    (`exoclick-shared-<zone>`). That is not a uuid, so the whole payload
    failed validation and returned 400 — dropping the impression AND the
    zone with it. `sendBeacon` never surfaces a response, so this was exactly
    the silent, confident-zero failure the note above describes, reintroduced
    by a different field.

    Accepted as free text and narrowed below: a real row id is stored, and
    anything else records against the ZONE with a null id. Losing which row
    served is a rounding error; losing the impression is the whole number.
  */
  adId: z.string().max(80).nullable().optional(),
});

/** Beacon endpoint for ad impressions/clicks. Rate-limited to resist floods. */
export async function POST(request: Request) {
  const ip = clientId(request.headers);
  const { success } = await trackLimiter.limit(ip);
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anon */
  }

  const { kind, zone } = parsed.data;
  /*
    Only a real row id reaches storage — `ad_events.ad_id` references `ads.id`,
    so a synthetic label would either violate the constraint or pollute the
    per-row report with a value that resolves to nothing.
  */
  const raw = parsed.data.adId ?? null;
  const adId =
    raw && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      ? raw
      : null;
  if (kind === "impression") {
    recordAdImpression(zone, adId ?? null, userId);
  } else {
    recordAdClick(zone, adId ?? null, userId);
    // Domain event (in-process, fire-and-forget) — clicks only; impressions would flood.
    emit("ad.clicked", { zone, adId: adId ?? null });
  }

  return NextResponse.json({ ok: true });
}
