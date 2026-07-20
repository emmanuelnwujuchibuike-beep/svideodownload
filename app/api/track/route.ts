import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdClick, recordAdImpression } from "@/lib/analytics/events";
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
  adId: z.string().uuid().nullable().optional(),
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

  const { kind, zone, adId } = parsed.data;
  if (kind === "impression") recordAdImpression(zone, adId ?? null, userId);
  else recordAdClick(zone, adId ?? null, userId);

  return NextResponse.json({ ok: true });
}
