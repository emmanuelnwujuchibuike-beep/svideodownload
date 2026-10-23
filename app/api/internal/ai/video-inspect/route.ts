import { NextResponse } from "next/server";
import { z } from "zod";

import { WORKER_SECRET } from "@/lib/worker";
import { inspectReferenceVideo } from "@/server/services/ai-video-inspect-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The WORKER's reference-video inspection (2026-10-19): ffprobe facts, and —
 * when asked — the people in it (server/services/ai-video-inspect-service.ts).
 * Synchronous: the member's route on Vercel waits for it. Called only by the
 * frontend with the shared secret, like every other internal route.
 */
const schema = z
  .object({
    userId: z.string().uuid(),
    path: z.string().min(1).max(300),
    detect: z.boolean(),
  })
  .strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) console.warn("[ai/inspect] WORKER_SECRET is not set on this worker — the inspect endpoint is UNAUTHENTICATED.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  const outcome = await inspectReferenceVideo(parsed.data);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : outcome.code === "FORBIDDEN" ? 403 : outcome.code === "NOT_FOUND" ? 404 : 422, headers: { "cache-control": "private, no-store" } });
}
