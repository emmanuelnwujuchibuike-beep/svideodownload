import { NextResponse } from "next/server";
import { z } from "zod";

import { WORKER_SECRET } from "@/lib/worker";
import { prepareCharacterReplaceJob } from "@/server/services/ai-character-replace-prepare-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/ai/prepare — the worker trims and normalises a
 * Character Replace job's video, then asks the frontend to submit it.
 *
 * Same posture as every other internal worker route (acquire, finalize):
 * enforce the shared secret when one is configured, warn loudly when none
 * is. One uuid in, nothing else — no field a path, a filter or a flag could
 * arrive through (see lib/ai/character-replace/ffmpeg.ts).
 *
 * Started and NOT awaited: the dispatcher's timeout is eight seconds and a
 * download + re-encode is tens of seconds. The service writes its own
 * outcome to the row; the rejection handler keeps a stray throw from taking
 * the worker process down.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn("[cr/prepare] WORKER_SECRET is not set on this worker — the prepare endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  const { jobId } = parsed.data;
  void prepareCharacterReplaceJob(jobId).catch((e) => {
    console.error("[cr/prepare] unhandled", { jobId, error: String(e) });
  });
  return NextResponse.json({ ok: true, accepted: true, jobId }, { status: 202 });
}
