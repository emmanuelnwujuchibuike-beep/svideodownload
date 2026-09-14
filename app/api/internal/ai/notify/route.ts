import { NextResponse } from "next/server";
import { z } from "zod";

import { notifyAiJobFromRow } from "@/lib/ai/notify";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/internal/ai/notify — the worker's hand-off for a push.
 *
 * The worker finishes jobs but holds no VAPID keys (2026-09-14: two completed
 * Character Replace jobs, no push). This route runs where the keys are, reads
 * the job's OUTCOME from the row (never from the body — one uuid in, nothing
 * else) and announces it once through the same claim every other announcer
 * uses. Same secret posture as every internal route.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) console.warn("[ai/notify] WORKER_SECRET is not set — the notify hand-off is UNAUTHENTICATED. Set it on both the worker and the frontend.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  try {
    const outcome = await notifyAiJobFromRow(parsed.data.jobId, { local: true });
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    console.error("[ai/notify] internal route threw", { jobId: parsed.data.jobId, error: String(e) });
    return NextResponse.json({ ok: false, detail: "notify threw" }, { status: 200 });
  }
}
