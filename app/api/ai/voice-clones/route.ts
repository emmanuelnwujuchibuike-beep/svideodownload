import { NextResponse } from "next/server";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { listVoiceClones, voiceCloneToView } from "@/lib/ai/voice-clone/clones";
import { voiceCloneSlotsFor } from "@/lib/ai/voice-clone/config";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/voice-clones — the member's Voice Library, newest first, with their slot count. Never a provider voice id. */
export async function GET(request: Request) {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-vc-list:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  try {
    const ownerId = subjectOwnerId(subject);
    const [rows, settings, entitlement, adminUser] = await Promise.all([listVoiceClones(ownerId), getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const total = voiceCloneSlotsFor(settings.frenzAiVoiceClone, { audience: entitlement.audience, isAdmin: !!adminUser });
    return NextResponse.json({ voices: rows.map(voiceCloneToView), slots: { used: rows.filter((r) => r.status === "ready" || r.status === "pending").length, total } }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/vc] list failed", { subject: subject.key, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
