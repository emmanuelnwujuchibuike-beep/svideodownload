import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { notifyAdminsOfInstall } from "@/lib/analytics/install-alert";
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

  /*
    Push the admins on a COMPLETED install (owner, 2026-08-23: "let a push
    notification be sent to the admin on every install").

    Gated on `pwa_installed` specifically — the browser's own `appinstalled`
    event — not on `pwa_install_accepted`, which only means somebody tapped
    Install in our sheet and can still be followed by the OS cancelling. An
    alert that fires on intent would tell the owner about installs that never
    happened.

    Deliberately NOT awaited: this is a fire-and-forget beacon called with
    `keepalive` from a page that is often mid-unload, and the client discards
    the response. Blocking it on a push fan-out would add latency to a request
    nobody is waiting for, and `notifyAdminsOfInstall` already swallows its own
    failures.
  */
  if (event === "pwa_installed") {
    void notifyAdminsOfInstall({ platform: platform ?? null, userId });
  }

  return NextResponse.json({ ok: true });
}
