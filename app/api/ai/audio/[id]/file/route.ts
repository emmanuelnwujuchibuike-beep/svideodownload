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
 * GET /api/ai/audio/[id]/file
 *
 *   (no params)     JSON: a short-lived signed URL, for the in-page player.
 *   ?download=1     THE FILE ITSELF, streamed from here with
 *                   `Content-Disposition: attachment`.
 *
 * ── 🔴 WHY THE BYTES NOW PASS THROUGH HERE (owner, 2026-09-27) ──────────────
 *
 * "Saving audio opens as web, it should save the way Downloads save."
 *
 * Save used to 302 to the Supabase signed URL. That is a CROSS-ORIGIN
 * navigation, and this codebase already has the law for what browsers do with
 * those: the `download` attribute is ignored off-origin, so the phone opens the
 * file in its own player instead of saving it. The rest of the app never has
 * this problem because its downloads proxy through `/api/download`, which is
 * same-origin — this is the same fix for the same reason.
 *
 * The standing warning against proxying media through a function
 * (lib/ai/storage-server.ts) is about VIDEO. This is the poster-frame exception
 * in that same note: an audio file is hundreds of kilobytes, it is streamed
 * rather than buffered, and it is bounded below — a serverless invocation is a
 * fair price for a Save button that actually saves.
 *
 * `redirect=1` is still accepted so an older client keeps working, but it is no
 * longer what the app asks for.
 */
/** A generous ceiling on a file we made ourselves; the finalizer's own limit is the same number. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

/** Safe for a `Content-Disposition` header — quotes and control characters are how a header gets split. */
function attachmentName(name: string, mime: string): string {
  const ext = mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : mime === "audio/mp4" ? "m4a" : "mp3";
  const base =
    name
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      .replace(/[\u0000-\u001F\u007F"\\;\r\n]/g, "")
      .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "frenz-ai-audio";
  return `${base}.${ext}`;
}
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
    if (download) {
      // kept for an older client that still asks for the redirect
      if (url.searchParams.get("redirect") === "2") return NextResponse.redirect(signed.url, { status: 302, headers: { "cache-control": "no-store" } });
      if (asset.bytes > MAX_STREAM_BYTES) return NextResponse.redirect(signed.url, { status: 302, headers: { "cache-control": "no-store" } });
      const upstream = await fetch(signed.url, { cache: "no-store" });
      if (!upstream.ok || !upstream.body) {
        console.error("[ai/audio] stream failed", { id, status: upstream.status });
        return NextResponse.json(aiErrorBody("STORAGE_ERROR"), { status: aiErrorStatus("STORAGE_ERROR") });
      }
      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          "content-type": asset.mime || "audio/mpeg",
          "content-disposition": `attachment; filename="${attachmentName(asset.name, asset.mime)}"`,
          ...(asset.bytes > 0 ? { "content-length": String(asset.bytes) } : {}),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return NextResponse.json({ url: signed.url, expiresIn: signed.expiresIn, mime: asset.mime, bytes: asset.bytes, durationMs: asset.duration_ms }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (isAiJobError(e)) return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    console.error("[ai/audio] file threw", { subject: subject.key, id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
