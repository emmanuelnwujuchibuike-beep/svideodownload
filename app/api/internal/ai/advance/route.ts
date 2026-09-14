import { NextResponse } from "next/server";
import { z } from "zod";

import { WORKER_SECRET } from "@/lib/worker";
import { advanceCharacterReplaceJob } from "@/server/services/ai-character-replace-advance-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/ai/advance — WORKER ONLY (Part 6).
 *
 * Between two provider stages of a Character Replace job the frontend's
 * webhook asks this route to bring the finished stage's output home and
 * submit the next stage (server/services/ai-character-replace-advance-
 * service.ts). Same posture as every other internal worker route (prepare,
 * finalize): enforce the shared secret when one is configured, warn loudly
 * when none is; ONE uuid in and nothing else — no URL, no path, no stage
 * name a caller could steer.
 *
 * Answers like the finalize route: the outcome when it finishes inside a
 * short budget, otherwise 202 and the job row is where the result appears.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();
const REPORT_BUDGET_MS = 6_000;

export async function POST(request: Request) {
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn("[cr/advance] WORKER_SECRET is not set on this worker — the advance endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.");
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

  const work = advanceCharacterReplaceJob(jobId).catch((e) => {
    console.error("[cr/advance] escaped the service", { jobId, error: String(e) });
    return { ok: false as const, jobId, code: "ADVANCE_FAILED" as const, detail: String(e) };
  });
  const outcome = await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), REPORT_BUDGET_MS))]);
  if (outcome === null) return NextResponse.json({ ok: true, accepted: true, pending: true }, { status: 202 });
  return NextResponse.json(
    {
      ok: outcome.ok,
      accepted: true,
      code: "code" in outcome ? outcome.code : null,
      detail: "detail" in outcome ? outcome.detail : null,
      skipped: "skipped" in outcome ? outcome.skipped : null,
    },
    { status: 200 },
  );
}
