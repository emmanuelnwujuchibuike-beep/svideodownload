import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createCharacterReplaceBatchSchema, isValidBatchRequestId } from "@/lib/ai/character-replace/batch-schema";
import { countOpenJobs, openCharacterReplaceJob, openGate, screenCreateFacts, validateCreateFacts, type OpenedJob } from "@/lib/ai/character-replace/open-job";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { findJobByRequestId, findOwnActiveBatchId, listOwnBatchJobs } from "@/lib/ai/job-store";
import { supersedeOwnDrafts } from "@/lib/ai/retention";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  /api/ai/character-replace/batches — a multi-video session (0166)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POST opens N jobs at once — one photo, N videos, the same settings — and
 * mints each job's upload tickets. It is the single create route N times
 * with the shared checks run ONCE (lib/ai/character-replace/open-job.ts):
 * the switches, the entitlement, every video's facts against the mode's
 * ceilings, the acceptable-use screen, the open-jobs ceiling. Nothing is
 * charged; every job is a draft until the batch is started.
 *
 * Idempotent on `batchRequestId`: a retried request finds the jobs it
 * already opened (each carries `<batchRequestId>:<index>` as its own
 * client_request_id) and returns them with fresh tickets. The batch id is
 * the first job's, so a retry never mints a second batch.
 *
 * GET answers "which of my batches is still in flight" — the workspace asks
 * on open so a member who comes back finds their videos where they left
 * them (brief §14).
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  // One create per batch, whatever its size — the per-job limiter would refuse the seventh video of a legitimate ten.
  const burst = await aiJobCreateLimiter.limit(`ai-cr-batch:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createCharacterReplaceBatchSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { batchRequestId, videos, photo, references, audio } = parsed.data;
  const mode = parsed.data.mode ?? "full_character";
  if (!isValidBatchRequestId(batchRequestId)) return fail("INVALID_INPUT");

  try {
    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiCharacterReplace;
    const gate = await openGate({ subject, feature, settings, entitlement, config }, mode);
    if (!gate.ok) return fail(gate.code, gate.extra);
    const ctx = { subject, feature, settings, entitlement, config, publicConfig: gate.publicConfig };

    // The queue is what lets a batch's extra videos wait their turn; without it there is no honest way to accept N.
    if (!config.processing.queueEnabled && videos.length > 1) return fail("CR_QUEUE_OFF");
    if (videos.length > config.processing.maxVideosPerBatch) return fail("CR_BATCH_TOO_LARGE", { maxVideos: config.processing.maxVideosPerBatch, requested: videos.length });

    // Every video against the same ceilings the single route applies — the first refusal names its video.
    for (const [i, video] of videos.entries()) {
      const facts = { mode, photo, references, audio, video };
      const invalid = validateCreateFacts(ctx, mode, facts, `Video ${i + 1}`);
      if (invalid) return fail(invalid.code, { ...(invalid.extra ?? {}), videoIndex: i + 1 });
      const blocked = screenCreateFacts(subject.key, facts);
      if (blocked) return fail(blocked.code, { videoIndex: i + 1 });
    }

    const ownerId = subjectOwnerId(subject);
    // A retried create: the first job names the batch every other one joined.
    const first = await findJobByRequestId(subject, `${batchRequestId}:1`);
    const batchId = first?.batch_id ?? randomUUID();

    // Part 10: abandoned drafts from OTHER sessions go; this batch's own drafts (a retried create) stay.
    await supersedeOwnDrafts(ownerId, feature.id, new Date(), { keepBatchId: batchId });

    /*
      The open-jobs ceiling (brief §3, §18): what is already waiting or
      running plus this batch may not exceed the operator's figure. Drafts
      are not counted — they are what is being made — and a retried create
      counts its own jobs only once because they are drafts too.
    */
    if (!first) {
      const open = await countOpenJobs(subject, feature, { includeDrafts: false });
      if (open + videos.length > config.processing.maxVideosPerBatch) {
        return fail("CR_QUEUE_FULL", { openJobs: open, maxOpenJobs: config.processing.maxVideosPerBatch, canAdd: Math.max(0, config.processing.maxVideosPerBatch - open) });
      }
    }

    const opened: OpenedJob[] = [];
    for (const [i, video] of videos.entries()) {
      const result = await openCharacterReplaceJob(ctx, {
        clientRequestId: `${batchRequestId}:${i + 1}`,
        mode,
        facts: { mode, photo, references, audio, video },
        lineage: null,
        batch: { id: batchId, index: i + 1, size: videos.length },
      });
      if ("ok" in result) {
        // A job past its draft (a retried create after a start): it is part of the batch already; the client reads it from the batch view.
        if (result.code === "JOB_ALREADY_PROCESSING" && typeof result.extra?.jobId === "string") continue;
        console.error("[cr/batch] open failed mid-batch", { batchId, index: i + 1, code: result.code });
        return fail(result.code, { ...(result.extra ?? {}), videoIndex: i + 1, batchId });
      }
      opened.push(result);
      if (result.created) await recordJobEvent(result.row.id, "batch.created", { batchId, index: i + 1, size: videos.length });
    }

    console.info("[cr/batch] opened", { batchId, userId: ownerId, mode, videos: videos.length, created: opened.filter((o) => o.created).length, audience: entitlement.audience });
    return NextResponse.json(
      {
        batchId,
        size: videos.length,
        jobs: opened.map((o) => ({ job: jobToView(o.row, storedErrorMessage), created: o.created, uploads: o.uploads })),
      },
      { status: opened.some((o) => o.created) ? 201 : 200 },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/batch] create failed", { subject: subject.key, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/batch] create threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}

/** GET ?active=1 — the member's most recent batch with a job still in flight, with its jobs. */
export async function GET(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobReadLimiter.limit(`ai-cr-batch-read:${subject.key}`);
  if (!burst.success) return fail("RATE_LIMITED");
  try {
    const batchId = await findOwnActiveBatchId(subject, feature.id);
    if (!batchId) return NextResponse.json({ batch: null });
    const rows = await listOwnBatchJobs(subject, batchId);
    return NextResponse.json({ batch: { id: batchId, size: rows.length }, jobs: rows.map((r) => jobToView(r, storedErrorMessage)) });
  } catch (e) {
    console.error("[cr/batch] active read threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
