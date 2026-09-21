import { NextResponse } from "next/server";

import { stateFromWebhookBody } from "@/lib/ai/replicate/provider";
import { readWebhookHeaders, verifyReplicateWebhook } from "@/lib/ai/replicate/signature";
import { handleProviderCallback } from "@/lib/ai/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  ⚠️ Was 300s in Part 3, when this route copied the finished video itself. It no
  longer moves a single byte of video: it records where the output is and hands
  the job to the ffmpeg worker (lib/ai/finalize-dispatch.ts). Two small database
  writes and a fire-and-forget POST.
*/
export const maxDuration = 30;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/replicate/webhook — how a Replicate job finishes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 THIS ENDPOINT IS PUBLIC, SO THE SIGNATURE IS THE WHOLE SECURITY MODEL ─
 *
 * Anyone can POST here. Without verification, a stranger who guesses the URL
 * could send `{"id":"…","status":"succeeded","output":"https://their-file"}`
 * and we would mark somebody's job complete and store THEIR file as that
 * member's result. The prediction id is not a secret either — it appears in our
 * own logs and responses. So:
 *
 *   1. the RAW body is read first and verified before anything parses it —
 *      re-serialising JSON changes bytes and breaks the signature;
 *   2. only then is it parsed;
 *   3. the prediction id is looked up against a UNIQUE column, so one callback
 *      resolves to exactly one job.
 *
 * ── The handling is shared (2026-09-21) ────────────────────────────────────
 *
 * Everything after verification — the stage bookkeeping, the CAS transitions
 * that make retries harmless, the hand-off to the worker, the refund-once on
 * failure — is lib/ai/webhook-handler.ts, the same function the fal.ai route
 * calls. This route's own job is Replicate's signature and Replicate's body
 * shape, nothing else. Behaviour is what it was before the split.
 *
 * ── Always 200, even when we refuse ──────────────────────────────────────────
 *
 * A non-2xx makes Replicate retry, so anything that will never succeed on a
 * retry — a forged signature, an unknown prediction — is answered 200 with a
 * plain body and logged. Genuine transient failures on OUR side return 500 so a
 * retry does happen.
 */
export async function POST(request: Request) {
  const secret = process.env.REPLICATE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Nothing may be accepted without the means to check it. Loud on our side, silent on theirs.
    console.error("[ai/webhook] REPLICATE_WEBHOOK_SECRET is not set — refusing every delivery");
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // 🔴 text(), not json(). The signature covers these exact bytes.
  const rawBody = await request.text();
  const verdict = verifyReplicateWebhook({ headers: readWebhookHeaders(request.headers), rawBody, secret });

  if (!verdict.valid) {
    console.warn("[ai/webhook] rejected", { reason: verdict.reason });
    // 200: a forged or stale delivery will not become valid on a retry, and
    // answering 401 would only teach a prober which guesses got further.
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const state = stateFromWebhookBody(body);
  if (!state) return NextResponse.json({ ok: false }, { status: 200 });

  const answer = await handleProviderCallback(state, { provider: "replicate", log: "ai/webhook" });
  return NextResponse.json(answer.body, { status: answer.status });
}
