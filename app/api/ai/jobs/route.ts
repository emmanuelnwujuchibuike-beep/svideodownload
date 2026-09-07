import { NextResponse } from "next/server";

import { extensionForUpload } from "@/lib/ai/clean-media";
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
import {
  countActiveJobs,
  createJob,
  findJobByRequestId,
  listOwnJobs,
  reserveSourcePath,
} from "@/lib/ai/job-store";
import { hasProviderFor } from "@/lib/ai/providers";
import { hasWorker } from "@/lib/worker";
import { createSourceUploadTicket } from "@/lib/ai/storage-server";
import { peekAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/jobs — open a job and hand back an upload target
 *  GET  /api/ai/jobs — this member's history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 WHAT THE CLIENT MAY SAY ───────────────────────────────────────────────
 *
 * A feature id, a description of its input, and an idempotency key. The schema
 * is `.strict()`, so a body carrying `user_id`, `provider`, `model`, `status` or
 * `result_path` is REFUSED rather than quietly stripped. Identity comes from the
 * session, the provider from the registry, the status is always `queued`, and
 * both storage paths are the server's.
 *
 * ── The allowance is NOT charged here (changed in Part 3) ────────────────────
 *
 * Part 2 reserved a slot at creation, because creation was the whole flow. Now
 * a job is opened BEFORE the video exists — the upload needs a path, and the
 * path needs a job id — so charging here would bill somebody for choosing a
 * file and changing their mind, or for an upload that died on a train.
 *
 * The reservation moved to `/start`, one line before the provider call, which
 * is the first moment the work costs anything. What still guards this endpoint
 * is the concurrency cap: an unstarted job is active, so nobody accumulates
 * them.
 *
 * ── The order of the gates ───────────────────────────────────────────────────
 *
 *   identity → burst → shape → registry → input rules → idempotency →
 *   entitlement → concurrency → write → upload ticket
 */

const capabilities = (): AiCapabilities => {
  const clean = aiFeature("ai_clean");
  return {
    // One truth: a feature is runnable when a registered adapter says it holds
    // its credentials. `hasProviderFor` reads the same registry the start route
    // dispatches through, so the answer here cannot differ from the answer there.
    replicate: !!clean && hasProviderFor(clean),
    // The ffmpeg worker. A job that cannot be finalized must never be started —
    // see the note on AiCapabilities.finalizer.
    finalizer: hasWorker,
    /*
      🔴 DEVELOPMENT ONLY. Lets a job be created while no provider is configured,
      so the plumbing can be exercised. The job sits at `queued`, nothing
      advances it, and the response says `dispatch.ready: false`. Production
      leaves it unset, so creation there answers FEATURE_UNAVAILABLE rather than
      filling a member's history with rows nothing can finish.
    */
    allowUndispatched: ["1", "true", "yes"].includes(
      (process.env.FRENZ_AI_ALLOW_UNDISPATCHED_JOBS || "").toLowerCase(),
    ),
  };
};

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
  const userId = await currentUserId();
  if (!userId) return fail("AUTH_REQUIRED");

  // Keyed by member, not by IP: this guards a per-account spend, and several
  // people behind one office address are not one abuser.
  const burst = await aiJobCreateLimiter.limit(`ai-job:${userId}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

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

  const feature = aiFeature(featureId);
  if (!feature) return fail("FEATURE_UNAVAILABLE");

  const availability = featureAvailability(feature, capabilities());
  if (!availability.available) return fail("FEATURE_UNAVAILABLE", { error: availability.reason });

  const verdict = validateJobInput(feature, source);
  if (!verdict.ok) return fail(verdict.code);

  try {
    const entitlement = await getUserAIEntitlement(userId, feature);
    if (!entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    /*
      IDEMPOTENCY. A retry returns the job it already made — and a fresh upload
      ticket with it, because the reason a client retries is usually that the
      first ticket never arrived.
    */
    const existing = await findJobByRequestId(userId, clientRequestId);
    if (existing) {
      const upload =
        existing.status === "queued"
          ? await createSourceUploadTicket({
              userId,
              feature: feature.id,
              jobId: existing.id,
              extension: extensionForUpload(source.name, source.mimeType),
            })
          : null;
      return NextResponse.json({
        job: jobToView(existing, storedErrorMessage),
        created: false,
        upload,
        usage: usageForClient(entitlement, await peekAiUsage(userId, feature.id)),
        dispatch: { ready: availability.dispatchable },
      });
    }

    const active = await countActiveJobs(userId, feature.id);
    if (active >= entitlement.maxConcurrent) return fail("JOB_ALREADY_PROCESSING");

    const result = await createJob({ userId, feature, source, clientRequestId });

    /*
      The upload target. Server-built path, signed for one exact object — the
      browser never names a key, so it cannot write into another member's folder
      however the request is crafted.
    */
    const upload = await createSourceUploadTicket({
      userId,
      feature: feature.id,
      jobId: result.row.id,
      extension: extensionForUpload(source.name, source.mimeType),
    });
    // The key is recorded now, so /start reads it back rather than guessing it
    // from a MIME type the picker may have got wrong. See reserveSourcePath.
    await reserveSourcePath(result.row.id, upload.path);

    console.info("[ai/jobs] opened", {
      jobId: result.row.id,
      userId,
      feature: feature.id,
      provider: feature.provider,
      created: result.created,
      dispatchable: availability.dispatchable,
      plan: entitlement.plan,
    });

    return NextResponse.json(
      {
        job: jobToView(result.row, storedErrorMessage),
        created: result.created,
        upload,
        usage: usageForClient(entitlement, await peekAiUsage(userId, feature.id)),
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
 * GET /api/ai/jobs?limit=&cursor=&feature=&active=1
 *
 * This member's own jobs, newest first, keyset-paged. `active=1` narrows to the
 * jobs still going to change, which is what a RETURNING member's page asks for:
 * it is the query behind "your video is still being processed" after a refresh,
 * a PWA relaunch, or a connection that dropped and came back.
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
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(MAX_PAGE, limitParam)) : DEFAULT_PAGE;

  const featureParam = url.searchParams.get("feature");
  // An unknown filter is refused rather than ignored: silently returning
  // everything for a filter somebody expected to narrow things is how a page
  // shows rows its reader did not ask for.
  if (featureParam && !aiFeature(featureParam)) return fail("INVALID_INPUT");

  try {
    const page = await listOwnJobs(userId, {
      limit,
      cursor: url.searchParams.get("cursor"),
      feature: (featureParam as AiFeature | null) ?? null,
      activeOnly: url.searchParams.get("active") === "1",
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
