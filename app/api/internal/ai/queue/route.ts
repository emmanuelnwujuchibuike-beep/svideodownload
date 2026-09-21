import { NextResponse } from "next/server";
import { z } from "zod";

import { pumpCharacterReplaceQueue } from "@/lib/ai/character-replace/queue";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/internal/ai/queue — the WORKER asking the frontend to look at a
 * member's line (0166). The worker finishes and fails jobs (finalize,
 * prepare, advance) and has no provider credentials to hand the next one
 * on with; the frontend does. The same posture as /api/internal/ai/submit
 * and /notify: the shared secret when one is configured, one small body,
 * nothing a path or a flag could arrive through.
 *
 * Awaited here (unlike the notify hop) because the pump is what the caller
 * wanted and it is quick — one lock, one indexed read, at most a handful of
 * eight-second dispatches. The answer is the pump's own report.
 */
const schema = z.object({ userId: z.string().uuid().nullable().optional(), reason: z.string().max(60).optional() }).strict();

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn("[cr/queue] WORKER_SECRET is not set on this frontend — the queue endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  const result = await pumpCharacterReplaceQueue({ userId: parsed.data.userId ?? null, reason: `worker:${parsed.data.reason ?? "unspecified"}` });
  return NextResponse.json({ ok: true, ...result });
}
