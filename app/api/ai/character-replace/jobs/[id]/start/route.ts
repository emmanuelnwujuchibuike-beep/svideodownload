import { NextResponse } from "next/server";

import { requestQueuePump } from "@/lib/ai/character-replace/queue-signal";
import { startCharacterReplaceJob } from "@/lib/ai/character-replace/start-job";
import { startCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs/[id]/start — THE endpoint that spends
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 4, §11 / §13): validate → calculate → claim →
 * reserve → hand off, in one request, every failure after the reservation
 * refunding exactly once. The whole sequence lives in
 * lib/ai/character-replace/start-job.ts since 2026-09-21 so the multi-video
 * batch route runs the identical one per video; this file only reads the
 * request, applies the burst limiter, and turns the verdict into a response.
 *
 * 0166: with the operator's queue on, a member already at their concurrency
 * cap is no longer refused — the job is paid for and holds its place
 * (`waiting`), and the pump is asked to look at the line straight away.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-cr-start:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = startCharacterReplaceJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");

  try {
    const settings = await getLandingSettings();
    const outcome = await startCharacterReplaceJob({ subject, request, jobId: id, body: parsed.data, queue: settings.frenzAiCharacterReplace.processing.queueEnabled, via: "single" });
    if (!outcome.ok) return fail(outcome.code, outcome.extra);
    if ("alreadyStarted" in outcome) return NextResponse.json({ job: jobToView(outcome.job, storedErrorMessage), started: false });
    if (outcome.waiting) {
      // Look at the line now — a slot may already be free (the pump is race-safe; a second look costs one indexed read).
      requestQueuePump(subject.userId, "start");
    }
    return NextResponse.json({ job: jobToView(outcome.job, storedErrorMessage), started: outcome.started, waiting: outcome.waiting, balanceCents: outcome.balanceCents, billing: outcome.billing });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/start] failed", { subject: subject.key, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/start] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
