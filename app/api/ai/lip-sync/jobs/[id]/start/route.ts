import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { startLipSyncJobSchema } from "@/lib/ai/lip-sync/schemas";
import { startLipSyncJob } from "@/lib/ai/lip-sync/start-job";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/lip-sync/jobs/[id]/start — fund and hand off ONE Lip Sync Pro
 * job (lib/ai/lip-sync/start-job.ts): the signed quote re-verified and
 * recomputed, the speech fields resolved server-side, the route decided and
 * written on the row, complimentary → credits → wallet, the claim, the
 * reservation, the worker. Idempotent: a second press answers the state the
 * first produced.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_lip_sync");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-ls-start:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return fail("JOB_NOT_FOUND");
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = startLipSyncJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  try {
    const outcome = await startLipSyncJob({ subject, request, jobId: id, body: parsed.data });
    if (!outcome.ok) return fail(outcome.code, outcome.extra);
    return NextResponse.json({ job: jobToView(outcome.job, storedErrorMessage), started: outcome.started, balanceCents: outcome.balanceCents, billing: outcome.billing, credits: outcome.credits });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[lipsync/start] failed", { subject: subject.key, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[lipsync/start] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
