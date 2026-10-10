import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { WORKER_SECRET } from "@/lib/worker";
import { runAdVideoTranscode } from "@/server/services/ad-video-transcode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// worker only (ffmpeg); this hint matters only if Vercel ever ran it, where it would fail anyway
export const maxDuration = 300;

/**
 * POST /api/internal/ads/transcode — WORKER ONLY.
 *
 * Cloudflare Stream could not take an ad video (2026-10-10: its storage is
 * full), so the frontend marked the creative and handed it here: ffmpeg
 * compresses it to 480p and it is published from Supabase Storage
 * (server/services/ad-video-transcode.ts).
 *
 * The request is ONE creative id — no paths, URLs or codecs. Everything is read
 * from the row, and only a row marked for this worker is touched, so a caller
 * can neither choose what ffmpeg reads nor re-run a finished creative.
 *
 * Same secret posture as /api/internal/ai/finalize: refused on a wrong or
 * missing secret when one is set. It answers 202 at once and keeps working —
 * this route only ever runs on a long-lived Node server, and the outcome is
 * written to the creative (the advertiser's status poll reads it there).
 */
const schema = z.object({ creativeId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) console.warn("[ads/transcode] WORKER_SECRET is not set on this worker — the transcode endpoint is UNAUTHENTICATED.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const { creativeId } = parsed.data;
  void runAdVideoTranscode(createAdminClient(), creativeId)
    .then((r) => console.info("[ads/transcode] done", { creativeId, state: r.state }))
    .catch((e) => console.error("[ads/transcode] crashed", { creativeId, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
