import { NextResponse } from "next/server";

import { WORKER_SECRET } from "@/lib/worker";
import { runSubBlurClips } from "@/server/services/sub-blur-clip-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// worker only (ffmpeg); this hint matters only if Vercel ever ran it, where it would fail anyway
export const maxDuration = 300;

/**
 * POST /api/internal/sub/blur-clips — WORKER ONLY.
 *
 * Makes the blurred clip every locked exclusive video still lacks, and the blurred still every locked post lacks
 * (server/services/sub-blur-clip-service.ts) — owner, 2026-10-29: every exclusive post autoplays blurred to a
 * non-subscriber. Kicked by the frontend when a feed read finds a locked video without a clip (lib/sub/blur-clip-kick.ts).
 *
 * The request carries NOTHING: the work list is read from the database, so a caller can neither choose what ffmpeg
 * reads nor where anything is written. Same secret posture as /api/internal/ads/transcode; it answers 202 at once and
 * keeps working on the long-lived worker process.
 */
export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) console.warn("[sub/blur-clips] WORKER_SECRET is not set on this worker — the endpoint is UNAUTHENTICATED.");
  void runSubBlurClips()
    .then((r) => console.info("[sub/blur-clips] done", r))
    .catch((e) => console.error("[sub/blur-clips] crashed", e instanceof Error ? e.message.slice(0, 200) : "error"));
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
