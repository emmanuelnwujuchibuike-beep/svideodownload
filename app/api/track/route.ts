import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdClick, recordAdImpression } from "@/lib/analytics/events";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES = [
  "homepage_top",
  "download_result_page",
  "sidebar",
  "exit_intent_popup",
  "mobile_bottom_banner",
] as const;

const schema = z.object({
  kind: z.enum(["impression", "click"]),
  zone: z.enum(ZONES),
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
