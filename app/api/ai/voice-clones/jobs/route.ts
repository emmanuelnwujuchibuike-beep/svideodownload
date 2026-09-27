import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { createVoiceCloneJob } from "@/lib/ai/voice-clone/create";
import { createVoiceCloneJobSchema } from "@/lib/ai/voice-clone/schemas";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/voice-clones/jobs — open a draft and get one signed upload
 * ticket per sample (lib/ai/voice-clone/create.ts). Nothing is charged here,
 * nothing is consented to and nothing is sent to a provider: the member still
 * has to upload the files and press the button.
 *
 * Idempotent on `clientRequestId` — a retry after a half-finished upload finds
 * the same draft and gets fresh tickets for it.
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const burst = await aiJobCreateLimiter.limit(`ai-vc-create:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createVoiceCloneJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT", { error: parsed.error.issues[0]?.path?.[0] === "name" ? "Give your voice a name." : undefined });
  if (!isValidClientRequestId(parsed.data.clientRequestId)) return fail("INVALID_INPUT");
  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const outcome = await createVoiceCloneJob({ subject, feature, settings, entitlement, config: settings.frenzAiVoiceClone, isAdmin: !!adminUser }, parsed.data);
    if (!("ok" in outcome)) {
      return NextResponse.json({ job: jobToView(outcome.row, storedErrorMessage), created: outcome.created, uploads: outcome.uploads }, { status: outcome.created ? 201 : 200 });
    }
    return fail(outcome.code, outcome.extra);
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[ai/vc/jobs] failed", { subject: subject.key, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[ai/vc/jobs] threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
