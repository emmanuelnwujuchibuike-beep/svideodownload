import { NextResponse } from "next/server";

import { readCharacterReplaceMeta } from "@/lib/ai/character-replace/job-meta";
import { countOpenJobs, openCharacterReplaceJob, openGate, resolveLineage, type CreateFacts } from "@/lib/ai/character-replace/open-job";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { recordJobEvent } from "@/lib/ai/job-events";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob } from "@/lib/ai/job-store";
import { AI_SOURCE_BUCKET, pathBelongsTo } from "@/lib/ai/storage";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs/[id]/retry — a new attempt, files kept
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (multi-video brief §13): a failed video gets "Retry";
 * the retry creates a new attempt safely, never double-charges, respects the
 * balance and the concurrency, and preserves the failed job for history.
 *
 * The single-video "Try again" (Part 5 §7) re-uses the files still in the
 * browser's hand. On the batch board — after a refresh, on another device,
 * from a notification — there is no file in hand. So this route opens the
 * new attempt (`attempt + 1`, same project, same batch and position) and
 * COPIES the failed job's own inputs into the new job's folder, server
 * side: the video, the character photo, the references, the voice file.
 * Nothing is uploaded again and nothing new is stored beyond what the
 * attempt needs (the failed job's folder is cleaned by the retention sweep
 * on its own schedule).
 *
 * The new job is a DRAFT: the client then runs the media preflight for it
 * (the pass is bound to the copied objects' own etags) and starts it with a
 * fresh quote through the batch start route — the identical spend sequence,
 * the identical refusals, nothing charged here.
 *
 * Refused when the failed job's files are already gone (retention ran):
 * "choose the video again" — the single flow's own fallback.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-cr-retry:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  try {
    const prior = await getOwnJob(subject, id);
    if (!prior || prior.feature !== feature.id) return fail("JOB_NOT_FOUND");
    const lineage = await resolveLineage(subject, feature, prior.id);
    if ("ok" in lineage) return fail(lineage.code, lineage.extra);
    const meta = readCharacterReplaceMeta(prior.metadata);
    if (!meta) return fail("INVALID_INPUT", { error: "That video can't be retried here. Choose it again." });

    const ownerId = subjectOwnerId(subject);
    // Every source the new attempt needs, and that it still exists — the failed folder may have been swept.
    const sources = [
      { role: "video" as const, path: meta.video.path },
      { role: "character" as const, path: meta.character.path },
      ...meta.references.map((r, i) => ({ role: "reference" as const, path: r.path, index: i })),
      ...(meta.audio?.source === "upload" && meta.audio.upload?.path ? [{ role: "voice" as const, path: meta.audio.upload.path }] : []),
    ];
    for (const s of sources) if (!pathBelongsTo(s.path, ownerId, prior.id)) return fail("INTERNAL_ERROR");
    const objects = await Promise.all(sources.map((s) => statSourceObject(s.path)));
    if (objects.some((o) => !o || o.size <= 0)) return fail("INVALID_INPUT", { error: "The files from that attempt are no longer here. Choose the video again to retry.", filesGone: true });

    const [settings, entitlement] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature)]);
    const config = settings.frenzAiCharacterReplace;
    const gate = await openGate({ subject, feature, settings, entitlement, config }, meta.mode);
    if (!gate.ok) return fail(gate.code, gate.extra);
    const ctx = { subject, feature, settings, entitlement, config, publicConfig: gate.publicConfig };

    // The same ceiling as any other open (the retry is one more video in progress).
    if (config.processing.queueEnabled) {
      const open = await countOpenJobs(subject, feature, { includeDrafts: false });
      if (open >= config.processing.maxVideosPerBatch) return fail("CR_QUEUE_FULL", { openJobs: open, maxOpenJobs: config.processing.maxVideosPerBatch });
    }

    const facts: CreateFacts = {
      mode: meta.mode,
      photo: { name: meta.character.name ?? "photo", mimeType: meta.character.mime, size: meta.character.size, width: meta.character.width, height: meta.character.height },
      references: meta.references.map((r) => ({ name: r.name ?? "reference", mimeType: r.mime, size: r.size, width: r.width, height: r.height })),
      video: {
        name: typeof prior.metadata?.source_name === "string" ? prior.metadata.source_name : "video",
        mimeType: meta.video.mime,
        size: meta.video.size,
        durationMs: meta.video.durationMs,
        width: meta.video.width,
        height: meta.video.height,
        hasAudio: meta.video.hasAudio,
      },
      audio:
        meta.audio?.source === "upload" && meta.audio.upload
          ? { name: meta.audio.upload.name ?? "audio", mimeType: meta.audio.upload.mime, size: meta.audio.upload.size, durationMs: meta.audio.upload.durationMs ?? null }
          : undefined,
    };
    // Idempotent per attempt: the same failed job retried twice opens the same new row.
    const clientRequestId = `retry:${prior.id}:${lineage.attempt}`;
    const opened = await openCharacterReplaceJob(ctx, { clientRequestId, mode: meta.mode, facts, lineage, batch: null });
    if ("ok" in opened) return fail(opened.code, opened.extra);

    /* ── copy the inputs into the new attempt's own folder ─────────────────── */
    const storage = createAdminClient().storage.from(AI_SOURCE_BUCKET);
    const targets = [
      { from: meta.video.path, to: opened.uploads.video.path },
      { from: meta.character.path, to: opened.uploads.photo.path },
      ...meta.references.map((r, i) => ({ from: r.path, to: opened.uploads.references[i]?.path ?? null })),
      ...(meta.audio?.source === "upload" && meta.audio.upload?.path && opened.uploads.voice ? [{ from: meta.audio.upload.path, to: opened.uploads.voice.path }] : []),
    ].filter((t): t is { from: string; to: string } => !!t.to);
    for (const t of targets) {
      if (!pathBelongsTo(t.to, ownerId, opened.row.id)) return fail("INTERNAL_ERROR");
      const { error } = await storage.copy(t.from, t.to);
      if (error && !/already exists|duplicate/i.test(error.message)) {
        console.error("[cr/retry] copy failed", { from: prior.id, to: opened.row.id, message: error.message });
        return fail("INTERNAL_ERROR", { error: "We couldn't reuse the files from that attempt. Choose the video again." });
      }
    }
    await recordJobEvent(opened.row.id, "batch.created", { retryOf: prior.id, attempt: lineage.attempt, copied: targets.length, batchId: lineage.batch?.id ?? null });
    console.info("[cr/retry] opened attempt with copied inputs", { from: prior.id, jobId: opened.row.id, attempt: lineage.attempt, copied: targets.length, batch: lineage.batch?.id ?? null });
    return NextResponse.json({ job: jobToView((await getOwnJob(subject, opened.row.id)) ?? opened.row, storedErrorMessage), created: opened.created }, { status: opened.created ? 201 : 200 });
  } catch (e) {
    if (isAiJobError(e)) return fail(e.code);
    console.error("[cr/retry] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
