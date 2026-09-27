import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { audioAssetToView, deleteAudioAsset, getAudioAsset, renameAudioAsset } from "@/lib/ai/text-to-audio/assets";
import { renameAudioAssetSchema } from "@/lib/ai/text-to-audio/schemas";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-fA-F-]{36}$/;

async function gate(request: Request, kind: "read" | "write") {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return { error: NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") }) } as const;
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return { error: NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") }) } as const;
  const burst = await (kind === "read" ? aiJobReadLimiter : aiJobCreateLimiter).limit(`ai-audio-${kind}:${subject.key}`);
  if (!burst.success) return { error: NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } }) } as const;
  return { subject } as const;
}

/** GET /api/ai/audio/[id] — one library row. Somebody else's answers as none. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "read");
  if ("error" in g) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const asset = await getAudioAsset(subjectOwnerId(g.subject), id);
    if (!asset) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That audio is not in your library." }), { status: aiErrorStatus("JOB_NOT_FOUND") });
    return NextResponse.json({ asset: audioAssetToView(asset) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/** PATCH /api/ai/audio/[id] — rename. */
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
  const parsed = renameAudioAssetSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: "Give it a name." }), { status: aiErrorStatus("INVALID_INPUT") });
  try {
    const asset = await renameAudioAsset(subjectOwnerId(g.subject), id, parsed.data.name);
    if (!asset) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    return NextResponse.json({ asset: audioAssetToView(asset) });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}

/** DELETE /api/ai/audio/[id] — remove from the library (the file goes, the job is marked deleted). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(request, "write");
  if ("error" in g) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const deleted = await deleteAudioAsset(subjectOwnerId(g.subject), id);
    return NextResponse.json({ deleted });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/audio] delete threw", { subject: g.subject.key, id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
