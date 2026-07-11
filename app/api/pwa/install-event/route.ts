import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  event: z.enum(["pwa_install_prompt_shown", "pwa_install_accepted", "pwa_install_dismissed", "pwa_installed"]),
  platform: z.enum(["android", "ios", "ios-inapp", "desktop"]).optional(),
});

/** Beacon endpoint for the PWA install funnel — same shape as /api/track's ad
 * beacon, kept separate since it's a distinct concern (no ad zone/id here).
 * No PII: just an event name, an optional coarse platform string, and the
 * signed-in user id if there is one (same fields the ad beacon already
 * records). */
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

  const { event, platform } = parsed.data;
  trackEvent(event, { userId, metadata: platform ? { platform } : undefined });

  return NextResponse.json({ ok: true });
}
