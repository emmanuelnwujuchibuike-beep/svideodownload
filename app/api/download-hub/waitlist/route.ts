import { NextResponse } from "next/server";
import { z } from "zod";

import { GATEWAY_ACTIONS } from "@/lib/download-hub/actions";
import { hashClient } from "@/lib/download-hub/record";
import { resolveAvailability } from "@/lib/download-hub/recommend";
import { clientId, trackLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.string().max(64) });

/**
 * "Notify me" for a `planned` destination. See `docs/DOWNLOAD_HUB_RFC.md` §3.2.
 *
 * This route is what makes showing an unbuilt product honest rather than
 * decorative — the row is real, and the person genuinely gets told.
 *
 * Note the availability check: signing up for something that already EXISTS is
 * rejected. That is not pedantry — if an action's product ships and someone's
 * cached page still renders the old waitlist button, the correct response is to
 * refuse rather than to quietly collect a signup for a live product.
 */
export async function POST(request: Request) {
  const ip = clientId(request.headers);
  const { success } = await trackLimiter.limit(ip);
  if (!success) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const action = GATEWAY_ACTIONS.find((a) => a.id === parsed.data.action);
  if (!action) return NextResponse.json({ ok: false }, { status: 400 });
  if (resolveAvailability(action) !== "planned") {
    return NextResponse.json({ ok: false, error: "Already available." }, { status: 409 });
  }

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* anonymous signups are supported */
  }

  try {
    // Service role: the client must never be able to write arbitrary rows here,
    // and the dedupe index does the idempotency.
    const { error } = await createAdminClient()
      .from("product_waitlist")
      .insert({
        user_id: userId,
        ip_hash: userId ? "" : hashClient(request.headers),
        action_id: action.id,
      });

    // 23505 = unique violation: already on the list. That is a success from the
    // user's point of view, so report it as one.
    if (error && error.code !== "23505") {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
