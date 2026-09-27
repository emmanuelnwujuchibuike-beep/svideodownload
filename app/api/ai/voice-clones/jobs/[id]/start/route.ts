import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, jobToView } from "@/lib/ai/jobs";
import { getOwnJob } from "@/lib/ai/job-store";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { startVoiceCloneJob } from "@/lib/ai/voice-clone/start";
import { startVoiceCloneJobSchema } from "@/lib/ai/voice-clone/schemas";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The clone runs in this request's `after()`; the function has to live long enough to make it. */
export const maxDuration = 60;

/**
 * POST /api/ai/voice-clones/jobs/[id]/start — consent, price, fund, clone
 * (lib/ai/voice-clone/start.ts). The body MUST carry `consent: true`; the
 * schema is what makes that unskippable.
 *
 * The answer comes back as soon as the money is settled and the provider call
 * has been scheduled; the workspace polls /api/ai/jobs/[id] and shows the voice
 * a few seconds later.
 */
const UUID = /^[0-9a-fA-F-]{36}$/;

function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const { id } = await params;
  if (!UUID.test(id)) return fail("JOB_NOT_FOUND");
  const burst = await aiJobCreateLimiter.limit(`ai-vc-start:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = startVoiceCloneJobSchema.safeParse(raw);
  // a body with no `consent: true` does not parse — the member is told what is missing rather than given a generic refusal
  if (!parsed.success) return fail("INVALID_INPUT", { error: "Confirm you hold the rights to this voice before we make it.", consentRequired: true });
  try {
    const job = await getOwnJob(subject, id);
    if (!job || job.feature !== feature.id) return fail("JOB_NOT_FOUND");
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const outcome = await startVoiceCloneJob({ subject, feature, settings, entitlement, config: settings.frenzAiVoiceClone, isAdmin: !!adminUser }, { job, body: parsed.data });
    if (!outcome.ok) return fail(outcome.code, outcome.extra);
    return NextResponse.json({ job: jobToView(outcome.job, storedErrorMessage), billing: outcome.billing, balanceCents: outcome.balanceCents, credits: outcome.credits });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/vc/start] failed", { subject: subject.key, jobId: id, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/vc/start] threw", { subject: subject.key, jobId: id, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
