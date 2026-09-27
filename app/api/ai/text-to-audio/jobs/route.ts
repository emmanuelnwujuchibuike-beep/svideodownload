import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { generateTextToAudio } from "@/lib/ai/text-to-audio/generate";
import { createTextToAudioJobSchema } from "@/lib/ai/text-to-audio/schemas";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The direct route synthesises after the response; a long text needs the function to live that long. */
export const maxDuration = 60;

/**
 * POST /api/ai/text-to-audio/jobs — Generate: the one call of this tool
 * (lib/ai/text-to-audio/generate.ts). Idempotent on `clientRequestId`. The
 * answer is the job, already funded and running; the workspace polls
 * /api/ai/jobs/[id] until it completes and then plays the result.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-tta-job:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createTextToAudioJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT", { error: parsed.error.issues[0]?.path?.[0] === "text" ? "Type what you would like to hear." : undefined });
  if (!isValidClientRequestId(parsed.data.clientRequestId)) return fail("INVALID_INPUT");
  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const outcome = await generateTextToAudio({ subject, request, body: parsed.data, shared: { settings, entitlement, isAdmin: !!adminUser } });
    if (!outcome.ok) return fail(outcome.code, outcome.extra);
    return NextResponse.json({ job: jobToView(outcome.job, storedErrorMessage), created: outcome.created, billing: outcome.billing, balanceCents: outcome.balanceCents, credits: outcome.credits, freeCharactersUsed: outcome.freeCharactersUsed }, { status: outcome.created ? 201 : 200 });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/tta/jobs] failed", { subject: subject.key, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/tta/jobs] threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
