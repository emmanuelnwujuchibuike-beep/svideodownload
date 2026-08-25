import { NextResponse } from "next/server";
import { z } from "zod";

import { trackEvent } from "@/lib/analytics/events";
import { resolveBatchIdentity, withBatchIdentity } from "@/lib/downloads/batch-identity";
import { authorizeBatch } from "@/lib/downloads/multi-link";
import { clientId, rewardStartLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { sourceUrlSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The SHAPE of the batch, not its contents.

  Deliberately not the full item list: the items are separately validated
  against real extractor metadata by `startRewardSession`, which is the call
  that actually authorizes bytes. Sending them twice would mean two places
  could disagree about what was approved — the exact failure mode
  `redeemRewardItem`'s "the server substitutes what it stored" rule exists to
  prevent. This endpoint answers one question: may this caller run a batch of
  this size at all?

  `sources` IS validated as real URLs, because the count is the thing being
  policed and an array of 100 empty strings must not read as 100 sources.
*/
const schema = z.object({
  sources: z.array(sourceUrlSchema).min(1).max(64),
  itemCount: z.number().int().min(1).max(500),
  /* The localStorage mirror of the browser id — used only when the request
     carries no cookie. See lib/downloads/batch-identity.ts. */
  anonId: z.string().uuid().optional(),
});

/**
 * §16 step 4 — verify the daily quota (and the plan's source ceiling) BEFORE
 * any ad is shown. Spends nothing; `/commit` is what charges.
 *
 * The `max(64)`/`max(500)` on the schema are anti-abuse bounds, not the product
 * limits — a request past the real ceiling is refused by `authorizeBatch` with
 * the reason and the caller's true limits attached, so the UI can say what
 * actually applies instead of guessing.
 */
export async function POST(request: Request) {
  const ip = clientId(request.headers);
  // Borrowed from the reward flow on purpose: this is the same "cheap to spam,
  // nothing shown yet" shape as starting a reward session.
  const { success } = await rewardStartLimiter.limit(ip);
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
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

  /*
    Duplicate source URLs are collapsed BEFORE the count is policed.

    Otherwise the same link pasted three times would spend a free member's
    entire source allowance on one post — and the client already refuses to
    add a duplicate (§22), so a request carrying one is either a stale client
    or a crafted one. Neither should be charged for it.
  */
  const uniqueSources = new Set(parsed.data.sources.map((u) => u.trim()));

  try {
    const identity = resolveBatchIdentity({ request, userId, clientAnonId: parsed.data.anonId });
    const result = await authorizeBatch({
      userId,
      ip: identity.ip,
      anonId: identity.anonId,
      sourceCount: uniqueSources.size,
      itemCount: parsed.data.itemCount,
    });

    if (!result.ok) {
      trackEvent("batch_refused", {
        userId,
        metadata: { reason: result.reason, sources: uniqueSources.size, items: parsed.data.itemCount },
      });
      return withBatchIdentity(NextResponse.json(
        { error: result.message, code: result.reason, policy: result.policy, anonId: identity.mirrorId },
        { status: result.reason === "DAILY_LIMIT_REACHED" ? 429 : 403 },
      ), identity);
    }

    /*
      The batch id is minted HERE, server-side, not accepted from the client.

      It is the receipt key `/commit` charges against, so a client that chose
      its own could replay one it had already spent — or mint a fresh one per
      item and never be charged at all. Minting it here means the only ids in
      circulation are ones this endpoint issued after a real authorization.
    */
    const batchId = crypto.randomUUID();
    trackEvent("batch_authorized", {
      userId,
      metadata: { sources: uniqueSources.size, items: parsed.data.itemCount, plan: result.policy.plan },
    });

    return withBatchIdentity(NextResponse.json({
      batchId,
      rewardRequired: result.policy.rewardRequired,
      policy: result.policy,
      anonId: identity.mirrorId,
    }), identity);
  } catch {
    return NextResponse.json({ error: "Couldn't authorize this batch.", code: "INTERNAL" }, { status: 500 });
  }
}
