import { NextResponse } from "next/server";

import { directAllowedOrigin } from "@/lib/downloads/direct-ticket";
import { verifyWatermarkTicket } from "@/lib/media/watermark-ticket";
import { downloadLimiter } from "@/lib/rate-limit";
import { hasWorker, WORKER_SECRET } from "@/lib/worker";
import { watermarkVideo, WatermarkError } from "@/server/services/watermark-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/posts/watermark?t=… — THE WORKER burns the creator's @handle and the
 * Frenzsave mark into a post video and streams it back (owner, 2026-10-14).
 *
 * Only a role with ffmpeg answers: the worker, or a single-box deploy with no
 * DOWNLOAD_WORKER_URL. On Vercel (`hasWorker`) this is a 404 — the ticket
 * points the browser at the worker directly. The ticket comes from
 * /api/posts/:id/download after its plan, cap and visibility checks
 * (lib/media/watermark-ticket.ts); the per-IP download limiter still runs here.
 *
 * CORS: the site's own origins, as /api/download/direct does.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = directAllowedOrigin(request.headers.get("origin"));
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Content-Disposition", Vary: "Origin" }
    : { Vary: "Origin" };
}

function fail(request: Request, error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (hasWorker || !WORKER_SECRET) return new Response("Not found", { status: 404 });

  const ticket = verifyWatermarkTicket(new URL(request.url).searchParams.get("t"), WORKER_SECRET);
  if (!ticket) return fail(request, "This download link expired. Please try again.", 403);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { success } = await downloadLimiter.limit(ip);
  if (!success) return fail(request, "Too many downloads. Please wait a moment.", 429);

  try {
    const { body, size } = await watermarkVideo(ticket.src, ticket.handle);
    return new Response(body, {
      headers: {
        ...corsHeaders(request),
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="${ticket.name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(request, e instanceof WatermarkError ? e.message : "Couldn't add the watermark.", e instanceof WatermarkError ? e.status : 500);
  }
}
