import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { commitBatch } from "@/lib/downloads/multi-link";
import { clientId, rewardCompleteLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ batchId: z.string().uuid() });

/**
 * §16 step 10 — spend exactly one batch allowance, at the moment the downloads
 * actually start (after the reward was server-confirmed, or the member's plan
 * bypassed it).
 *
 * Idempotent per `batchId`: `commitBatch` writes a receipt keyed on it, so a
 * refresh mid-batch, a retried commit, or a re-mounted component all charge
 * once. Concurrency and multi-tab abuse are handled a layer down by
 * `consumeDaily`'s atomic per-day INCR, not here.
 *
 * ── Why a refusal here does NOT stop the download ─────────────────────────
 * By the time this is called the ad has already been watched in full and the
 * reward already granted server-side. Refusing the files at that point would
 * take payment and deliver nothing, which is worse than allowing one batch
 * over the line in a rare race. The client is told (`allowed: false`) so its
 * counter is honest and the NEXT batch is refused up front at `/authorize`,
 * where refusing is free.
 */
export async function POST(request: Request) {
  const ip = clientId(request.headers);
  const { success } = await rewardCompleteLimiter.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment.", code: "RATE_LIMITED" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body.", code: "INVALID_REQUEST" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid batch.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    if (request.headers.get("cookie")?.includes("-auth-token")) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    }
  } catch {
    /* anonymous */
  }

  try {
    const result = await commitBatch({ userId, ip, batchId: parsed.data.batchId });
    trackEvent("batch_started", {
      userId,
      metadata: { batchId: parsed.data.batchId, allowed: result.allowed },
    });
    return NextResponse.json(result);
  } catch {
    // Fail OPEN, like every other counter here: a broken quota store must never
    // be what stops a download that was already paid for with an ad.
    return NextResponse.json({ allowed: true, used: 0, remaining: null });
  }
}
