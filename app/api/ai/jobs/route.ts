import { NextResponse } from "next/server";

import { policyBlockEvent, screenAiJob } from "@/lib/ai/acceptable-use";
import { extensionForUpload } from "@/lib/ai/clean-media";
import { getAiEntitlement, usageForClient } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import {
  AI_JOB_STATUSES,
  aiFeature,
  createJobRequestSchema,
  featureAvailability,
  isValidClientRequestId,
  jobToView,
  validateJobInput,
  type AiCapabilities,
  type AiFeature,
  type AiJobStatus,
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
import { AI_SOURCE_URL_ERRORS, validateAiSourceUrl } from "@/lib/ai/source-url";
import { createSourceUploadTicket } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";
import { peekAiUsage } from "@/lib/ai/usage";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";

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


function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature0 = aiFeature("ai_clean");
  if (!feature0) return fail("FEATURE_UNAVAILABLE");

  /*
    🔴 NO SESSION REQUIRED (owner, 2026-09-08: "Do not force users to sign up
    before they can try the AI"). A guest opens a real job against a real
    allowance; what identifies them is a signed, HttpOnly identifier they
    cannot forge, plus the address ceiling applied at /start.
  */
  const resolution = await resolveAiSubject(request, feature0.id);
  const { subject } = resolution;

  // Keyed by SUBJECT, not by IP: this guards a per-account spend, and several
  // people behind one office address are not one abuser.
  const burst = await aiJobCreateLimiter.limit(`ai-job:${subject.key}`);
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

  /*
    ── 🔴 THE LINK GATE (Part 6) ──────────────────────────────────────────────

    Part 1 shipped the paste field with the owner's instruction written across
    it: "Do not implement URL downloading yet. Do not fetch arbitrary URLs from
    the browser." The browser half stays true forever. This is the server half,
    and it runs BEFORE a row exists so a refused link costs nothing and leaves
    nothing behind.

    `validateAiSourceUrl` is an ALLOW-LIST of the platforms this product already
    supports, not a deny-list of dangerous addresses — see the module for why
    that distinction is the whole defence. What is stored and what the worker
    later fetches is its NORMALISED output, never the string sent here.
  */
  const sourceKind = source.kind === "url" ? "url" : "upload";
  let normalisedUrl: string | null = null;

  if (sourceKind === "url") {
    // A link job is only offered where the worker can actually fetch it. The
    // capability check above covers the provider and the finalizer; this covers
    // the acquisition, which needs yt-dlp and therefore the Docker worker.
    if (!hasWorker) return fail("FEATURE_UNAVAILABLE");

    const link = validateAiSourceUrl(source.url ?? "");
    if (!link.ok) {
      console.info("[ai/jobs] link refused", { subject: subject.key, reason: link.reason });
      return fail("INVALID_INPUT", { error: AI_SOURCE_URL_ERRORS[link.reason] });
    }
    normalisedUrl = link.url;
  }

  /*
    ── 🔴 THE ACCEPTABLE-USE GATE ─────────────────────────────────────────────

    Owner, 2026-09-09: "Do NOT rely solely on frontend validation. The
    backend/API must enforce these restrictions."

    Placed HERE, and the position is the whole design:

      · AFTER the shape, registry and link checks, so a malformed request is
        still refused as malformed rather than as a policy matter;
      · BEFORE the entitlement read, the row insert and the upload ticket, so a
        refused request writes NOTHING — no job, no signed write into private
        storage, no allowance touched, nothing in anyone's history.

    What it reads is the only member-supplied text this feature has: the
    filename and, for a link job, the address. AI Clean takes no prompt, so
    there is no instruction to screen — see the module for the honest account
    of what that layer can and cannot see.

    🔴 The refusal is deliberately identical for every rule that could have
    fired, and the reason never leaves the server. A per-reason message would
    tell somebody probing this exactly which word to change, and it would turn
    a refusal into an accusation.
  */
  const policy = screenAiJob({
    sourceName: source.kind === "upload" ? (source.name ?? null) : null,
    sourceUrl: normalisedUrl,
    sourceKind,
  });
  if (!policy.allowed) {
    // Reason and a truncated subject only — never the text that matched. See
    // `policyBlockEvent` for why the string itself is not kept.
    console.info("[ai/jobs] policy block", policyBlockEvent(policy.reason, subject.key));
    return fail("POLICY_BLOCKED");
  }

  try {
    const entitlement = await getAiEntitlement(subject, feature);
    if (!entitlement.allowed) return fail("FEATURE_UNAVAILABLE");

    /*
      IDEMPOTENCY. A retry returns the job it already made — and a fresh upload
      ticket with it, because the reason a client retries is usually that the
      first ticket never arrived.
    */
    const existing = await findJobByRequestId(subject, clientRequestId);
    if (existing) {
      const upload =
        // 🔴 A LINK GETS NO UPLOAD TICKET. There is nothing for the browser to
        // send — the worker fetches the video — so minting one would hand out a
        // signed write into private storage that only an attacker would use.
        existing.status === "queued" && sourceKind !== "url"
          ? await createSourceUploadTicket({
              userId: subjectOwnerId(subject),
              feature: feature.id,
              jobId: existing.id,
              extension: extensionForUpload(source.name, source.mimeType ?? ""),
            })
          : null;
      return applyAiSubjectCookie(NextResponse.json({
        job: jobToView(existing, storedErrorMessage),
        created: false,
        upload,
        usage: usageForClient(entitlement, (await peekAiUsage(subject, feature.id)).usedToday),
        dispatch: { ready: availability.dispatchable },
      }), resolution);
    }

    const active = await countActiveJobs(subject, feature.id);
    if (active >= entitlement.maxConcurrent) return fail("JOB_ALREADY_PROCESSING");

    const result = await createJob({
      subject,
      feature,
      source,
      clientRequestId,
      // The validator's NORMALISED output, never the string the client sent.
      sourceUrl: normalisedUrl,
    });

    /*
      The upload target. Server-built path, signed for one exact object — the
      browser never names a key, so it cannot write into another member's folder
      however the request is crafted.

      🔴 Skipped entirely for a link. The bytes will be fetched by our worker
      and written with the service role, so there is nothing the browser needs
      to be authorised to do — and an unused signed upload url is a capability
      handed out for no reason.
    */
    const upload =
      sourceKind === "url"
        ? null
        : await createSourceUploadTicket({
            userId: subjectOwnerId(subject),
            feature: feature.id,
            jobId: result.row.id,
            extension: extensionForUpload(source.name, source.mimeType ?? ""),
          });
    // The key is recorded now, so /start reads it back rather than guessing it
    // from a MIME type the picker may have got wrong. See reserveSourcePath.
    if (upload) await reserveSourcePath(result.row.id, upload.path);

    console.info("[ai/jobs] opened", {
      jobId: result.row.id,
      subject: subject.key,
      feature: feature.id,
      provider: feature.provider,
      created: result.created,
      dispatchable: availability.dispatchable,
      audience: entitlement.audience,
    });

    return applyAiSubjectCookie(NextResponse.json(
      {
        job: jobToView(result.row, storedErrorMessage),
        created: result.created,
        upload,
        usage: usageForClient(entitlement, (await peekAiUsage(subject, feature.id)).usedToday),
        dispatch: {
          ready: availability.dispatchable,
          ...(availability.dispatchable ? {} : { reason: "The AI service isn't connected yet." }),
        },
      },
      { status: result.created ? 201 : 200 },
    ), resolution);
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/jobs] create failed", { subject: subject.key, feature: featureId, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/jobs] create threw", { subject: subject.key, feature: featureId, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;

/**
 * GET /api/ai/jobs?limit=&cursor=&feature=&active=1&status=a,b
 *
 * This member's own jobs, newest first, keyset-paged. `active=1` narrows to the
 * jobs still going to change, which is what a RETURNING member's page asks for:
 * it is the query behind "your video is still being processed" after a refresh,
 * a PWA relaunch, or a connection that dropped and came back.
 *
 * `status` is the history section's tabs (lib/ai/history.ts). It is a comma-
 * separated list and it is narrowed in SQL rather than in the browser, because
 * the list is keyset-paged: filtering a fetched page would leave "Cancelled"
 * empty next to a "Show more" button, twenty rows at a time, until it happened
 * to reach one.
 */
export async function GET(request: Request) {
  const feat = aiFeature("ai_clean");
  if (!feat) return fail("FEATURE_UNAVAILABLE");

  // A guest's history is their own jobs, scoped by their signed identifier —
  // see the note on `subjectScope` in lib/ai/job-store.ts.
  const resolution = await resolveAiSubject(request, feat.id);
  const { subject } = resolution;

  const burst = await aiJobReadLimiter.limit(`ai-read:${subject.key}`);
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

  /*
    The status filter, checked against the union rather than passed through.
    These values are interpolated into a PostgREST `in.(…)` list, so an
    unrecognised one is REFUSED — the same discipline as `feature` above, and
    for the stronger reason that a filter nobody validated is a filter somebody
    can write SQL into.
  */
  const statusParam = url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (statuses.some((s) => !(AI_JOB_STATUSES as readonly string[]).includes(s))) {
    return fail("INVALID_INPUT");
  }

  try {
    const page = await listOwnJobs(subject, {
      limit,
      cursor: url.searchParams.get("cursor"),
      feature: (featureParam as AiFeature | null) ?? null,
      activeOnly: url.searchParams.get("active") === "1",
      statuses: statuses as AiJobStatus[],
    });

    return NextResponse.json({
      jobs: page.rows.map((row) => jobToView(row, storedErrorMessage)),
      nextCursor: page.nextCursor,
    });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[ai/jobs] list threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
