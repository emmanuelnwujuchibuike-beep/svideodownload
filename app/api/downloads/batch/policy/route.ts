import { NextResponse } from "next/server";

import { resolveBatchIdentity, withBatchIdentity } from "@/lib/downloads/batch-identity";
import { getBatchPolicy } from "@/lib/downloads/multi-link";
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

  /* The localStorage mirror arrives as a query param on this GET — see
     batch-identity.ts for why a mirror exists at all. A present cookie always
     wins over it. */
  const identity = resolveBatchIdentity({
    request,
    userId,
    clientAnonId: new URL(request.url).searchParams.get("a"),
  });

  try {
    const policy = await getBatchPolicy({ userId, ip: identity.ip, anonId: identity.anonId });
    return withBatchIdentity(NextResponse.json({ ...policy, anonId: identity.mirrorId }, {
      // Never cached: it carries a per-identity allowance count that changes
      // as batches are spent, and a shared cache would hand one visitor
      // another's remaining count.
      headers: { "Cache-Control": "private, no-store" },
    }), identity);
  } catch {
    return NextResponse.json({ error: "Couldn't load batch policy." }, { status: 500 });
  }
}
