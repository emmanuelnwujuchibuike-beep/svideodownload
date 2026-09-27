import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getVoiceClone, signVoiceCloneSampleUrl } from "@/lib/ai/voice-clone/clones";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-fA-F-]{36}$/;

/**
 * GET /api/ai/voice-clones/[id]/sample — a short-lived signed URL for the
 * FIRST recording the member gave us, so they can hear what the voice was built
 * from.
 *
 * 🔴 Their own audio, not a generated preview. Making a preview would mean a
 * text-to-speech call, which is a charge, on a page where nobody asked for one.
 * The sample is already in our bucket, already theirs, and it is the honest
 * answer to "what did I give you?".
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  const burst = await aiJobReadLimiter.limit(`ai-vc-sample:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  try {
    const voice = await getVoiceClone(subjectOwnerId(subject), id);
    if (!voice) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That voice isn't in your library." }), { status: aiErrorStatus("JOB_NOT_FOUND") });
    const signed = await signVoiceCloneSampleUrl(voice);
    return NextResponse.json(signed, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/vc] sample failed", { subject: subject.key, id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
