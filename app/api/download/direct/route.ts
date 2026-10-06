import { NextResponse } from "next/server";

import { capFromHeader } from "@/lib/downloads/size-cap";
import { directAllowedOrigin, verifyDirectTicket } from "@/lib/downloads/direct-ticket";
import { downloadLimiter } from "@/lib/rate-limit";
import { hasWorker, WORKER_SECRET } from "@/lib/worker";
import { streamResolvedDownload } from "@/server/services/download-response";
import type { ApiError } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/download/direct?ticket=… — THE WORKER streams a download to the
 * browser itself (FOT brief, owner 2026-10-06).
 *
 * Only the WORKER role answers. On Vercel (`hasWorker`) this is a 404: the
 * whole point is that these bytes never pass through Vercel.
 *
 * The ticket was minted by Vercel's /api/download AFTER the rate limit, the
 * daily quota and any reward redemption — see lib/downloads/direct-ticket.ts
 * for why that ticket cannot be forged, altered or kept. The worker's per-IP
 * limiter still runs here, as it did on every proxied call.
 *
 * CORS: the browser's fetch is cross-origin (site → worker host), so the site's
 * own origins are echoed. A plain GET with no custom headers needs no preflight.
 * Content-Length / Content-Type are CORS-safelisted, so progress still works.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = directAllowedOrigin(request.headers.get("origin"));
  return origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Content-Disposition", Vary: "Origin" }
    : { Vary: "Origin" };
}

function fail(request: Request, error: string, code: ApiError["code"], status: number) {
  return NextResponse.json<ApiError>({ error, code }, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (hasWorker || !WORKER_SECRET) return new Response("Not found", { status: 404 });

  const payload = verifyDirectTicket(new URL(request.url).searchParams.get("ticket"), WORKER_SECRET);
  if (!payload) return fail(request, "This download link expired. Please try again.", "DOWNLOAD_TOKEN_EXPIRED", 403);

  const { success } = await downloadLimiter.limit(payload.ip);
  if (!success) return fail(request, "Too many downloads. Please wait a moment.", "RATE_LIMITED", 429);

  return streamResolvedDownload(payload.data, payload.hevc, corsHeaders(request), capFromHeader(payload.maxBytes || null));
}
