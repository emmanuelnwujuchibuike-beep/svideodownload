import { NextResponse } from "next/server";

import { getBatchPolicy } from "@/lib/downloads/multi-link";
import { clientId } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's real batch policy: plan, source ceiling, reward requirement and
 * how much of today's allowance is left.
 *
 * Reads only — `getBatchPolicy` uses `peekDaily`, never `consumeDaily`, so
 * opening the panel (or re-opening it, or having it mounted in two tabs) can
 * never cost someone a batch. That property is why this is a separate endpoint
 * from `/authorize` rather than a flag on it.
 */
export async function GET(request: Request) {
  const ip = clientId(request.headers);

  // Same "skip the Supabase round trip when there's no auth cookie" shortcut
  // used by every other anonymous-heavy route here.
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
    /* signed out — batch is open to anonymous visitors too */
  }

  try {
    const policy = await getBatchPolicy({ userId, ip });
    return NextResponse.json(policy, {
      // Never cached: it carries a per-identity allowance count that changes
      // as batches are spent, and a shared cache would hand one visitor
      // another's remaining count.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't load batch policy." }, { status: 500 });
  }
}
