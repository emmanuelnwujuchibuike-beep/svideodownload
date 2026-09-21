import { NextResponse } from "next/server";

import { readCharacterReplaceMeta } from "@/lib/ai/character-replace/job-meta";
import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { getOwnJob } from "@/lib/ai/job-store";
import { PREFLIGHT_STRICT, readPreflightRecord, recordMatches, VALIDATOR_UNAVAILABLE } from "@/lib/ai/preflight/gate";
import { PREFLIGHT_VALIDATOR_VERSION } from "@/lib/ai/preflight/config";
import { recordJobEvent } from "@/lib/ai/job-events";
import { retireRefusedDraft } from "@/lib/ai/retention";
import { createAdminClient } from "@/lib/supabase/admin";
import { PREFLIGHT_TIPS, preflightChecklist, preflightHeadline, preflightIssues, preflightWarnings } from "@/lib/ai/preflight/messages";
import { objectFingerprint, signPreflightToken } from "@/lib/ai/preflight/token";
import { pathBelongsTo } from "@/lib/ai/storage";
import { statSourceObject } from "@/lib/ai/storage-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiPreflightLimiter } from "@/lib/rate-limit";
import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";
import type { PreflightRecord } from "@/server/services/ai-preflight-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs/[id]/preflight — "Checking your media…"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * After the uploads, before Start (brief §12): the member's own job, still
 * `queued`, its photo and video in the bucket. This route
 *
 *   1. reuses the record on the row when it is for these exact objects, this
 *      mode and this validator, and fresh (a refresh, a double tap: nothing
 *      is measured twice — brief §14);
 *   2. otherwise has the WORKER measure and judge them, synchronously;
 *   3. answers the structured result, the checklist and the words, and — on
 *      a pass — the short-lived token Start requires (lib/ai/preflight/token.ts).
 *
 * Nothing here reserves, charges or reaches a provider. A worker that
 * cannot answer is "we couldn't check just now" — a member never pays for a
 * check that did not happen, and never starts on one (the gate at Start).
 */
const WORKER_TIMEOUT_MS = 55_000;

function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code), headers: { "cache-control": "private, no-store" } });
}

function shape(record: PreflightRecord, token: { token: string; expiresAt: number } | null) {
  const r = record.result;
  return {
    preflight: {
      valid: r.valid,
      mode: r.mode,
      result: r,
      checkedAt: record.checkedAt,
      durationMs: record.durationMs,
      checklist: preflightChecklist(r),
      issues: preflightIssues(r),
      warnings: preflightWarnings(r),
      headline: r.valid ? null : preflightHeadline(r.mode),
      tips: PREFLIGHT_TIPS[r.mode],
    },
    token: token?.token ?? null,
    tokenExpiresAt: token ? new Date(token.expiresAt).toISOString() : null,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  // brief §14: a member cannot run the vision layer indefinitely
  const burst = await aiPreflightLimiter.limit(`ai-cr-preflight:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))), "cache-control": "private, no-store" },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");
  const job = await getOwnJob(subject, id);
  if (!job || job.feature !== feature.id) return fail("JOB_NOT_FOUND");
  if (job.status !== "queued") return fail("INVALID_INPUT", { error: "This video has already been started." });
  const meta = readCharacterReplaceMeta(job.metadata);
  if (!meta) return fail("INTERNAL_ERROR");
  const ownerId = subjectOwnerId(subject);
  for (const p of [meta.video.path, meta.character.path]) if (!pathBelongsTo(p, ownerId, job.id)) return fail("INTERNAL_ERROR");

  const [reference, video] = await Promise.all([statSourceObject(meta.character.path), statSourceObject(meta.video.path)]);
  if (!reference || reference.size <= 0) return fail("INVALID_INPUT", { error: "The photo hasn't finished uploading yet." });
  if (!video || video.size <= 0) return fail("INVALID_INPUT", { error: "The video hasn't finished uploading yet." });

  const claims = { jobId: job.id, userId: ownerId, mode: meta.mode, reference: objectFingerprint(reference), video: objectFingerprint(video) };

  /* ── 1. a record for these exact objects is answered again ───────────── */
  const stored = readPreflightRecord(job.metadata);
  if (stored && recordMatches(stored, meta.mode, reference, video) && !stored.result.errors.includes("validator_unavailable")) {
    return NextResponse.json(shape(stored, stored.result.valid ? signPreflightToken(claims) : null), { headers: { "cache-control": "private, no-store" } });
  }

  /* ── 2. the worker measures and judges ───────────────────────────────── */
  /*
    ── A BROKEN CHECKER IS NOT A LOCKED DOOR (Part 11 QA, 2026-09-20) ──────
    When the worker cannot run the check at all — no worker, unreachable,
    declined, or its models missing — the member is let through with a
    signed pass that the gate reads as "skipped", the row records it, and
    the operator is told; a NEGATIVE verdict still stops them. See
    lib/ai/preflight/gate.ts (`AI_PREFLIGHT_STRICT=1` for a refusal instead).
  */
  const passThrough = async (detail: string) => {
    console.error("[cr/preflight] checker unavailable — passing the member through without a check", { jobId: job.id, detail: detail.slice(0, 200) });
    const record: PreflightRecord = {
      version: PREFLIGHT_VALIDATOR_VERSION,
      mode: meta.mode,
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      media: { reference: claims.reference, video: claims.video },
      hashes: null,
      result: {
        valid: false,
        mode: meta.mode,
        referenceImage: { valid: false, faceDetected: false, faceConfidence: null, faceVisibility: null, bodyVisibility: null, faceHeightFrac: null, sharpness: null },
        video: { valid: false, usableFrames: 0, sampledFrames: 0, faceVisibility: null, bodyVisibility: null, faceHeightFrac: null },
        compatibility: { valid: false, confidence: null },
        errors: [VALIDATOR_UNAVAILABLE],
        warnings: [],
        ambiguous: false,
        visionUsed: false,
      },
      measurements: null,
    };
    await createAdminClient().from("ai_jobs").update({ metadata: { ...(job.metadata ?? {}), preflight: record } }).eq("id", job.id).eq("status", "queued");
    await recordJobEvent(job.id, "preflight.skipped", { detail: detail.slice(0, 160) });
    const token = PREFLIGHT_STRICT ? null : signPreflightToken(claims);
    return NextResponse.json(
      {
        preflight: {
          valid: !PREFLIGHT_STRICT,
          mode: meta.mode,
          result: { ...record.result, valid: !PREFLIGHT_STRICT, errors: PREFLIGHT_STRICT ? [VALIDATOR_UNAVAILABLE] : [] },
          checkedAt: record.checkedAt,
          durationMs: 0,
          checklist: [],
          issues: PREFLIGHT_STRICT ? [{ code: VALIDATOR_UNAVAILABLE, target: "both", title: "We couldn't check your media just now", body: "Nothing was charged — try again in a moment." }] : [],
          warnings: ["check_skipped"],
          headline: null,
          tips: PREFLIGHT_TIPS[meta.mode],
          skipped: !PREFLIGHT_STRICT,
        },
        token: token?.token ?? null,
        tokenExpiresAt: token ? new Date(token.expiresAt).toISOString() : null,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  };
  if (!hasWorker) return passThrough("no worker configured");
  let record: PreflightRecord | null = null;
  try {
    const res = await fetch(`${WORKER_URL}/api/internal/ai/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}) },
      body: JSON.stringify({ jobId: job.id }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; record?: PreflightRecord; code?: string; detail?: string } | null;
    if (!res.ok || !body?.ok || !body.record) {
      return passThrough(`worker declined: ${res.status} ${body?.code ?? ""} ${body?.detail ?? ""}`);
    }
    record = body.record;
  } catch (e) {
    return passThrough(`worker unreachable: ${String(e)}`);
  }

  /* ── 3. the answer, and the pass when it passed ──────────────────────── */
  if (record.result.errors.includes(VALIDATOR_UNAVAILABLE)) {
    return passThrough("the worker could not run the detectors");
  }
  // the pass is bound to the objects the WORKER saw; if they differ from what this route just saw, no token (a replaced file mid-check)
  const bound = record.media.reference === claims.reference && record.media.video === claims.video;
  const token = record.result.valid && bound ? signPreflightToken(claims) : null;
  if (!record.result.valid) {
    // 🔴 a refusal is the end of THIS draft: the member replaces the file and the workspace opens a new job.
    // Left `queued`, it sat in history as a job in progress and opened as one (owner, 2026-09-20).
    const retired = await retireRefusedDraft({ id: job.id, source_path: job.source_path });
    await recordJobEvent(job.id, "preflight.refused", { errors: record.result.errors.slice(0, 6), retired });
  }
  return NextResponse.json(shape(record, token), { headers: { "cache-control": "private, no-store" } });
}
