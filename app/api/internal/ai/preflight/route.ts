import { NextResponse } from "next/server";
import { z } from "zod";

import { WORKER_SECRET } from "@/lib/worker";
import { runCharacterReplacePreflight } from "@/server/services/ai-preflight-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The WORKER's preflight (2026-09-20): download the job's photo and video,
 * measure them (server/preflight/detectors.ts), judge them for the job's
 * mode (lib/ai/preflight/decision.ts), store the record on the job row and
 * answer it. Synchronous — the member's route on Vercel waits for it — so a
 * member sees "Checking your media…" for the ten seconds it takes, not a
 * poll. Called only by the frontend with the shared secret, like every
 * other internal route; never by a browser.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn("[cr/preflight] WORKER_SECRET is not set on this worker — the preflight endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  const outcome = await runCharacterReplacePreflight(parsed.data.jobId);
  if (!outcome.ok) return NextResponse.json({ ok: false, code: outcome.code, detail: outcome.detail }, { status: outcome.code === "JOB_NOT_FOUND" ? 404 : 409 });
  // the measurements stay on the row; the answer carries what the member's route needs
  const { measurements: _measurements, ...record } = outcome.record;
  return NextResponse.json({ ok: true, record }, { headers: { "cache-control": "private, no-store" } });
}
