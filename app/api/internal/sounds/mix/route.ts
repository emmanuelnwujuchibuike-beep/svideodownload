import { NextResponse } from "next/server";

import { WORKER_SECRET } from "@/lib/worker";
import { runSoundMixes } from "@/server/services/sound-mix-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// worker only (ffmpeg); this hint matters only if Vercel ever ran it, where it would fail anyway
export const maxDuration = 300;

/**
 * POST /api/internal/sounds/mix — WORKER ONLY.
 *
 * Gives every reel made with "Use this sound" that sound as its audio (0308, server/services/sound-mix-service.ts).
 * Kicked by the publish that marked a reel (lib/social/sound-mix-kick.ts).
 *
 * The request carries NOTHING: the work list is read from the database, so a caller can neither choose what ffmpeg
 * reads nor where anything is written. It answers 202 at once and keeps working on the long-lived worker process.
 * Fails closed without WORKER_SECRET, like the blur-clip job (it runs ffmpeg and writes to the public bucket).
 */
export async function POST(request: Request) {
  if (!WORKER_SECRET) {
    console.error("[sounds/mix] WORKER_SECRET is not set on this worker — refusing.");
    return NextResponse.json({ ok: false, error: "Worker secret not configured" }, { status: 503 });
  }
  if (request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  void runSoundMixes()
    .then((r) => console.info("[sounds/mix] done", r))
    .catch((e) => console.error("[sounds/mix] crashed", e instanceof Error ? e.message.slice(0, 200) : "error"));
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
