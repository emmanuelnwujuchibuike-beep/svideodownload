import { NextResponse } from "next/server";
import { z } from "zod";

import { acquireAiJobSource } from "@/server/services/ai-acquire-service";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  On the worker there is no real ceiling; this hint only matters if Vercel ever
  runs it, and it would fail there anyway for want of yt-dlp. Same shape as
  `/api/internal/ai/finalize`.
*/
export const maxDuration = 300;

/**
 * POST /api/internal/ai/acquire — WORKER ONLY.
 *
 * ── 🔴 THE ENTIRE REQUEST IS ONE UUID ────────────────────────────────────────
 *
 * No url. That is the whole security design of Part 6 restated at the back
 * door: an internal endpoint that accepted a URL and fetched it would be an
 * SSRF proxy one leaked secret away from being usable, and it would bypass
 * `validateAiSourceUrl` completely.
 *
 * Everything the acquisition needs is read from the `ai_jobs` row, where the
 * address was written only after the allow-list accepted it — and the service
 * re-validates it again before making the request. So the worst a caller
 * holding the shared secret can do is make us re-fetch a link a member already
 * asked us for.
 *
 * ── Why it answers before it finishes ────────────────────────────────────────
 *
 * The caller is a member's `/start` request, which has to answer immediately so
 * the progress screen can appear. This validates, accepts the work, answers
 * 202, and lets the acquisition run to completion in the background — the job
 * row is where the outcome is reported, not this response.
 *
 * 🔴 No `after()`, deliberately. That helper exists for a serverless platform
 * that freezes the function on response. This route only ever runs on a
 * long-lived Node server, where the promise simply continues.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  /*
    The same posture as every other internal worker route: enforce the secret
    when one is configured, and warn loudly when one is not.

    🔴 NOT `!WORKER_SECRET || header !== WORKER_SECRET`. That inverted form is
    what 403'd every finalization for weeks on a worker with no secret set,
    while downloads kept working — one posture for every worker route is itself
    the fix, and having two rules is how the odd one stayed wrong unnoticed.
  */
  if (WORKER_SECRET && request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    // Identical answer for a missing secret and a wrong one.
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!WORKER_SECRET) {
    console.warn(
      "[ai/acquire] WORKER_SECRET is not set on this worker — the acquire endpoint is UNAUTHENTICATED. Set it on both the worker and the frontend.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "INVALID_BODY" }, { status: 400 });
  }

  const { jobId } = parsed.data;

  /*
    Started and NOT awaited. The dispatcher's timeout is eight seconds and an
    acquisition is tens of seconds to minutes, so awaiting here would make every
    successful fetch look like a failed hand-off.

    The rejection handler is not optional: an unhandled rejection on a
    long-lived Node worker can take the process down, which would fail every
    download on the box for an unrelated-looking reason.
  */
  void acquireAiJobSource(jobId).catch((e) => {
    console.error("[ai/acquire] unhandled", { jobId, error: String(e) });
  });

  return NextResponse.json({ ok: true, accepted: true, jobId }, { status: 202 });
}
