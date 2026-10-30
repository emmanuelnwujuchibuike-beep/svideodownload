import { NextResponse } from "next/server";

import { WORKER_SECRET } from "@/lib/worker";
import { blurClipReadiness, runSubBlurClips } from "@/server/services/sub-blur-clip-service";

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
 * reads nor where anything is written. It answers 202 at once and keeps working on the long-lived worker process.
 *
 * 🔴 FAILS CLOSED (code review, 2026-10-30): with no WORKER_SECRET on the worker it refuses every call instead of
 * running unauthenticated — this job presigns private files, runs up to 40 ffmpeg jobs and writes to the public bucket,
 * so an open endpoint was a free CPU and egress loop for anyone. The frontend always sends the secret (Vercel has it;
 * fly.toml's deploy steps set it on the worker). Nothing is lost while it refuses: the creator's browser still makes
 * clips on publish and on visits (features/sub/blur-clip-backfill.ts).
 */
/**
 * GET — the worker's own readiness for this job, for the admin check (app/api/admin/sub/blur-clips): storage, the private
 * bucket and ffmpeg, as booleans only (never a key or a bucket name). Same secret as the job.
 */
export async function GET(request: Request) {
  if (!WORKER_SECRET) return NextResponse.json({ ok: false, error: "Worker secret not configured" }, { status: 503 });
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, ...(await blurClipReadiness()) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!WORKER_SECRET) {
    console.error("[sub/blur-clips] WORKER_SECRET is not set on this worker — refusing (set it with `fly secrets set WORKER_SECRET=…`).");
    return NextResponse.json({ ok: false, error: "Worker secret not configured" }, { status: 503 });
  }
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  void runSubBlurClips()
    .then((r) => console.info("[sub/blur-clips] done", r))
    .catch((e) => console.error("[sub/blur-clips] crashed", e instanceof Error ? e.message.slice(0, 200) : "error"));
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
