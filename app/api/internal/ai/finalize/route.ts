import { NextResponse } from "next/server";
import { z } from "zod";

import { finalizeAICleanJob } from "@/server/services/ai-finalize-service";
import { WORKER_SECRET } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  On the worker there is no real ceiling; this hint only applies if Vercel ever
  runs it, and it would fail there anyway for want of ffmpeg. Same shape as
  `/api/internal/store-media`, which does the same kind of work.
*/
export const maxDuration = 300;

/**
 * POST /api/internal/ai/finalize — WORKER ONLY.
 *
 * ── 🔴 THE ENTIRE REQUEST IS ONE UUID ────────────────────────────────────────
 *
 * No paths, no URLs, no codecs, no arguments, no user id. Everything the mux
 * needs is read from the `ai_jobs` row on the other side of this call, which
 * means there is no field here for a caller to influence what ffmpeg does. That
 * is a stronger property than validating a richer body would be: the dangerous
 * inputs are not rejected, they do not exist.
 *
 * Protected by the shared worker secret, the same gate
 * `/api/internal/store-media` uses. Without it, this endpoint would be a way
 * for anyone to make our machine download and transcode video on demand.
 *
 * ── Why it answers before it finishes ────────────────────────────────────────
 *
 * The caller is a Vercel webhook that must not be held open for minutes (see
 * lib/ai/finalize-dispatch.ts). This accepts the work, answers 202, and lets
 * the finalizer run to completion in the background — the job row is where the
 * outcome is reported, not this response.
 *
 * 🔴 No `after()` here, deliberately. That helper exists for a serverless
 * platform that would otherwise freeze the function the moment it responds.
 * This route only ever runs on a long-lived Node server, where the promise
 * simply continues; wrapping it would add a Vercel-shaped dependency to the one
 * file guaranteed never to run there.
 */
const schema = z.object({ jobId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (!WORKER_SECRET || request.headers.get("x-worker-secret") !== WORKER_SECRET) {
    // Identical answer for a missing secret and a wrong one. A route that is
    // more specific about which is a route that helps somebody guess.
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const { jobId } = parsed.data;

  /*
    Started, not awaited. The finalizer writes its own outcome to the job row
    and logs its own failures, so nothing here needs the result — and the
    dispatcher on the other end has an eight-second timeout it is entitled to
    hit without that meaning anything went wrong.
  */
  void finalizeAICleanJob(jobId).catch((e) => {
    // Anything reaching here escaped the service's own try/catch, which would
    // be a bug in the service rather than a failed job. Logged loudly.
    console.error("[ai/finalize] escaped the service", { jobId, error: String(e) });
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
