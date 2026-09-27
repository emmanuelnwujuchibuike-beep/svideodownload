import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getAudioAsset, signAudioAssetUrl } from "@/lib/ai/text-to-audio/assets";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/audio/[id]/file — a short-lived signed URL for playback
 * (JSON), or with `?download=1&redirect=1` a 302 to a URL that saves the
 * file under the member's own name (the result route's contract: the
 * Content-Disposition is storage's, no bytes pass through here).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-audio-file:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  try {
    const asset = await getAudioAsset(subjectOwnerId(subject), id);
    if (!asset) return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That audio is not in your library." }), { status: aiErrorStatus("JOB_NOT_FOUND") });
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "1";
    const signed = await signAudioAssetUrl(asset, download);
    if (download && url.searchParams.get("redirect") === "1") return NextResponse.redirect(signed.url, { status: 302, headers: { "cache-control": "no-store" } });
    return NextResponse.json({ url: signed.url, expiresIn: signed.expiresIn, mime: asset.mime, bytes: asset.bytes, durationMs: asset.duration_ms }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/audio] file threw", { subject: subject.key, id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
