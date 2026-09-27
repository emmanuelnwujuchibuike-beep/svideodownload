import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { deleteVoiceClone, getVoiceClone, renameVoiceClone, voiceCloneToView } from "@/lib/ai/voice-clone/clones";
import { renameVoiceCloneSchema } from "@/lib/ai/voice-clone/schemas";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-fA-F-]{36}$/;

async function gate(request: Request, kind: "read" | "write") {
  const feature = aiFeature("ai_voice_clone");
  if (!feature) return { error: NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") }) } as const;
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return { error: NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") }) } as const;
  const burst = await (kind === "read" ? aiJobReadLimiter : aiJobCreateLimiter).limit(`ai-vc-${kind}:${subject.key}`);
  if (!burst.success) return { error: NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } }) } as const;
  return { subject } as const;
}

/** GET /api/ai/voice-clones/[id] — one voice. Somebody else's answers as none. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "read");
  if ("error" in g) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const voice = await getVoiceClone(subjectOwnerIdOf(g.subject), id);
    if (!voice) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That voice isn't in your library." }), { status: aiErrorStatus("JOB_NOT_FOUND") });
    return NextResponse.json({ voice: voiceCloneToView(voice) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/** PATCH /api/ai/voice-clones/[id] — rename. Our row is the name the member sees; the provider is renamed best-effort. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "write");
  if ("error" in g) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const parsed = renameVoiceCloneSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: "Give it a name." }), { status: aiErrorStatus("INVALID_INPUT") });
  try {
    const settings = await getLandingSettings();
    const voice = await renameVoiceClone(subjectOwnerIdOf(g.subject), id, parsed.data.name, parsed.data.description, settings.frenzAiVoiceClone);
    if (!voice) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    return NextResponse.json({ voice: voiceCloneToView(voice) });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/**
 * DELETE /api/ai/voice-clones/[id] — remove the voice.
 *
 * 🔴 This frees a slot at the PROVIDER as well as removing our row, and it also
 * deletes the member's recordings. It is not undoable, which is why the
 * interface confirms first. A provider failure refuses the whole delete rather
 * than leaving a slot nobody can reclaim (lib/ai/voice-clone/clones.ts).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "write");
  if ("error" in g) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const settings = await getLandingSettings();
    const outcome = await deleteVoiceClone(subjectOwnerIdOf(g.subject), id, settings.frenzAiVoiceClone);
    return NextResponse.json({ deleted: outcome.deleted });
  } catch (e) {
    if (isAiJobError(e)) {
      // the vendor refused: the voice is still there and the member can try again — nothing has been half-removed
      console.error("[ai/vc] delete refused", { subject: g.subject.key, id, code: e.code, detail: e.detail });
      return NextResponse.json(aiErrorBody(e.code, { error: "We couldn't remove that voice just now. Try again in a moment." }), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/vc] delete threw", { subject: g.subject.key, id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/** Narrowed here so each handler reads plainly; the gate has already refused a guest. */
function subjectOwnerIdOf(subject: Parameters<typeof subjectOwnerId>[0]): string {
  return subjectOwnerId(subject);
}
