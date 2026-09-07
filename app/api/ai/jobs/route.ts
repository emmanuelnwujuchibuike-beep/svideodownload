import { NextResponse } from "next/server";

import { getUserAIEntitlement, usageForClient } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import {
  aiFeature,
  createJobRequestSchema,
  featureAvailability,
  isValidClientRequestId,
  jobToView,
  validateJobInput,
  type AiCapabilities,
  type AiFeature,
} from "@/lib/ai/jobs";
import { countActiveJobs, createJob, findJobByRequestId, listOwnJobs } from "@/lib/ai/job-store";
import { releaseAiUsage, reserveAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/jobs — create one · GET /api/ai/jobs — this member's history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2). The route is deliberately dull: it validates,
 * decides, writes one row and answers. Every judgement it makes lives in a
 * module it calls, and it holds no connection open for anything.
 *
 * ── 🔴 WHAT THE CLIENT MAY SAY ───────────────────────────────────────────────
 *
 * A feature id, a description of its input, and an idempotency key. That is the
 * entire schema, and it is a closed one — `.strict()` rejects a body carrying
 * anything else rather than ignoring it, so a request trying `user_id`,
 * `provider`, `model`, `status` or `result_path` is refused outright instead of
 * quietly succeeding while a reader wonders whether those fields did anything.
 *
 * The identity comes from the session cookie. The provider comes from the
 * registry. The status is always `queued`. The paths are null.
 *
 * ── The order of the gates, and why ──────────────────────────────────────────
 *
 *   1. identity      — anonymous costs nothing to refuse, so it goes first
 *   2. burst limit   — before any database work
 *   3. shape         — before any lookup
 *   4. registry      — an impossible feature is refused before a charge
 *   5. idempotency   — a retry must not reach the counter at all
 *   6. entitlement   — one authority for what a plan is worth
 *   7. concurrency   — cheap count, and it protects the provider
 *   8. reserve       — the atomic charge, last, so nothing after it can waste it
 *
 * A failure at 8 or later gives the slot back (see the release below). A
 * failure before it never took one.
 */

const CAPABILITIES: AiCapabilities = {
  // Part 2 ships no adapter. This is what makes every honest refusal honest.
  replicate: !!process.env.REPLICATE_API_TOKEN?.trim(),
  /*
    🔴 DEVELOPMENT ONLY, and off unless a deployment opts in. It permits a job
    to be CREATED while nothing exists to run it, so ownership, idempotency and
    the daily cap can be exercised end to end before Part 3. The job sits at
    `queued` forever and never reports success — nothing in this codebase can
    move it, because no provider is registered. Production leaves this unset,
    which is why creating a job there answers FEATURE_UNAVAILABLE instead of
    filling somebody's history with rows that will never finish.
  */
  allowUndispatched: ["1", "true", "yes"].includes(
    (process.env.FRENZ_AI_ALLOW_UNDISPATCHED_JOBS || "").toLowerCase(),
  ),
};

/** The signed-in member, or null. Never trusts anything in the request body. */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  /* 1 · IDENTITY. */
  const userId = await currentUserId();
  if (!userId) return fail("AUTH_REQUIRED");

  /* 2 · BURST. Keyed by member, not by IP: this guards a per-account spend. */
  const burst = await aiJobCreateLimiter.limit(`ai-job:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  /* 3 · SHAPE. */
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createJobRequestSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { feature: featureId, clientRequestId, source } = parsed.data;

  if (!isValidClientRequestId(clientRequestId)) return fail("INVALID_INPUT");

  /* 4 · REGISTRY. What exists, and whether anything can run it. */
  const feature = aiFeature(featureId);
  if (!feature) return fail("FEATURE_UNAVAILABLE");

  const availability = featureAvailability(feature, CAPABILITIES);
  if (!availability.available) {
    // The registry's own sentence replaces the generic one — the member is owed
    // the actual reason, and there is exactly one place that knows it.
    return fail("FEATURE_UNAVAILABLE", { error: availability.reason });
  }

  const verdict = validateJobInput(feature, source);
  if (!verdict.ok) return fail(verdict.code);

  try {
    /* 5 · IDEMPOTENCY. A retry must never reach the counter. */
    const existing = await findJobByRequestId(userId, clientRequestId);
    if (existing) {
      return NextResponse.json({
        job: jobToView(existing, storedErrorMessage),
        // `false` tells an honest client "this is the job you already had",
        // which is the difference between a retry and a second submission.
        created: false,
        dispatch: { ready: availability.dispatchable },
      });
    }

    /* 6 · ENTITLEMENT — plan, promo and ceiling, resolved once. */
    const entitlement = await getUserAIEntitlement(userId, feature);
    if (!entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    /* 7 · CONCURRENCY. */
    const active = await countActiveJobs(userId, feature.id);
    if (active >= entitlement.maxConcurrent) return fail("JOB_ALREADY_PROCESSING");

    /* 8 · RESERVE. Atomic, and the last thing that can refuse. */
    const reservation = await reserveAiUsage(userId, feature.id, entitlement.dailyLimit);
    if (!reservation.allowed) {
      return fail("DAILY_LIMIT_REACHED", {
        usage: usageForClient(entitlement, reservation.used),
      });
    }

    /*
      The write. If it fails the slot goes back immediately — a member must not
      lose one of three daily runs to a database that was briefly unhappy, which
      is exactly the case `release_ai_usage` exists for.
    */
    let result;
    try {
      result = await createJob({ userId, feature, source, clientRequestId });
    } catch (e) {
      await releaseAiUsage(userId, feature.id, entitlement.dailyLimit);
      throw e;
    }

    if (!result.created) {
      // Two identical requests raced and the unique index resolved it. The
      // loser's reservation is given back, so a double tap costs one slot.
      await releaseAiUsage(userId, feature.id, entitlement.dailyLimit);
    }

    /*
      Structured, and deliberately not carrying content: ids, the feature, the
      provider and the outcome. Never a filename, never a path, never a token.
    */
    console.info("[ai/jobs] created", {
      jobId: result.row.id,
      userId,
      feature: feature.id,
      provider: feature.provider,
      created: result.created,
      dispatchable: availability.dispatchable,
      plan: entitlement.plan,
      used: reservation.used,
    });

    return NextResponse.json(
      {
        job: jobToView(result.row, storedErrorMessage),
        created: result.created,
        usage: usageForClient(entitlement, reservation.used),
        /*
          🔴 The honest half. `ready: false` means the job is recorded and
          NOTHING will run it — said out loud so no interface can present a
          queued row as work in progress.
        */
        dispatch: {
          ready: availability.dispatchable,
          ...(availability.dispatchable ? {} : { reason: "The AI service isn't connected yet." }),
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/jobs] create failed", { userId, feature: featureId, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/jobs] create threw", { userId, feature: featureId, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

/**
 * GET /api/ai/jobs?limit=&cursor=&feature=
 *
 * This member's own jobs, newest first, keyset-paged. There is no "all jobs"
 * mode and no way to ask about somebody else: the query runs as the member and
 * is filtered by their id, so the worst a crafted request can do is page
 * through its own history.
 */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return fail("AUTH_REQUIRED");

  const burst = await aiJobReadLimiter.limit(`ai-read:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(MAX_PAGE, limitParam))
    : DEFAULT_PAGE;

  const featureParam = url.searchParams.get("feature");
  // An unknown feature filter is refused rather than ignored: silently
  // returning everything for a filter somebody expected to narrow things is how
  // a history page shows rows its reader did not ask for.
  if (featureParam && !aiFeature(featureParam)) return fail("INVALID_INPUT");

  try {
    const page = await listOwnJobs(userId, {
      limit,
      cursor: url.searchParams.get("cursor"),
      feature: (featureParam as AiFeature | null) ?? null,
    });

    return NextResponse.json({
      jobs: page.rows.map((row) => jobToView(row, storedErrorMessage)),
      nextCursor: page.nextCursor,
    });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[ai/jobs] list threw", { userId, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
