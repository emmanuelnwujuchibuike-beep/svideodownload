import { NextResponse } from "next/server";

import { klingConfigured, klingGetTask } from "@/lib/ai/kling/client";
import { readKlingCallbackHeaders, verifyKlingCallback } from "@/lib/ai/kling/signature";
import { klingDataFromEnvelope, klingTaskId, stateFromKlingTask } from "@/lib/ai/kling/status";
import { handleProviderCallback } from "@/lib/ai/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
  Like the Replicate and fal routes: this moves no video. It records where the
  output is and hands the job to the ffmpeg worker. Kling asks for a 2xx within
  five seconds, which is what the two database writes and one fire-and-forget
  POST behind `handleProviderCallback` cost.
*/
export const maxDuration = 30;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/webhooks/kling — how a direct Kling task finishes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Public, like the other two provider callbacks, so nothing may be believed
 * because it arrived. A stranger who guesses this URL can POST
 * `{"data":{"task_id":"…","task_status":"succeed","task_result":{"videos":
 * [{"url":"https://their-file"}]}}}` — and without the rules below we would
 * mark somebody's job complete and store a stranger's file as their result.
 * The task id is not a secret either; it is in our own logs.
 *
 * ── 🔴 THE TWO DOORS, AND WHY THERE ARE TWO ────────────────────────────────
 *
 *   1. SIGNED — a `KLING_WEBHOOK_SECRET` is set and the delivery verifies
 *      (lib/ai/kling/signature.ts). The body is then the vendor's own word
 *      and is used directly, exactly as the Replicate and fal routes use a
 *      verified body.
 *
 *   2. UNVERIFIED — no secret is configured, or the delivery failed to
 *      verify. The body is then **discarded as evidence**. Only the task id
 *      is taken from it, and the state is fetched from Kling over OUR
 *      authenticated connection (`klingGetTask`). Whoever posted can
 *      therefore cause exactly one authenticated read of a task id they
 *      already knew, and nothing else: the outcome that reaches the job is
 *      the vendor's, not theirs.
 *
 * Door 2 exists because Kling's signature scheme could not be read from the
 * official documentation on 2026-09-28 (its reference site is a client-
 * rendered app that returns a bare title to any non-browser fetch). Rather
 * than guess a scheme and fail open, the seam is built so that guessing wrong
 * costs one extra API read instead of a forged completion. When Part 3
 * confirms the live scheme, door 2 can be narrowed to "signature missing" or
 * removed entirely.
 *
 * ── Two further guards, both already in the shared handler ─────────────────
 *
 *   · the task id is matched against a UNIQUE column, so one callback
 *     resolves to exactly one job;
 *   · the row's own `provider` must be `kling`, so a Kling delivery can never
 *     finish a Replicate job even with a colliding id.
 *
 * ── Always 200, even when we refuse ────────────────────────────────────────
 *
 * A non-2xx makes a provider retry, and Kling retries on timeout. Anything
 * that will never succeed on a retry — a forged delivery, an unknown task —
 * is answered 200 with a plain body and logged; 401 would only teach a prober
 * which guesses got further. Genuine transient failures on OUR side answer
 * 500, which the shared handler decides.
 */
export async function POST(request: Request) {
  // 🔴 text(), not json(). A signature covers these exact bytes; re-serialising JSON changes them.
  const rawBody = await request.text();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const secret = process.env.KLING_WEBHOOK_SECRET?.trim();
  const verdict = secret ? verifyKlingCallback({ headers: readKlingCallbackHeaders(request.headers), rawBody, secret }) : ({ valid: false, reason: "no-secret" } as const);

  /* ── door 1 · a verified delivery is the vendor's own word ──────────────── */
  if (verdict.valid) {
    const state = stateFromKlingTask(klingDataFromEnvelope(body));
    if (!state) return NextResponse.json({ ok: false }, { status: 200 });
    const answer = await handleProviderCallback(state, { provider: "kling", log: "ai/webhook-kling" });
    return NextResponse.json(answer.body, { status: answer.status });
  }

  /* ── door 2 · unverified: take the id, believe nothing else ─────────────── */
  const reference = klingTaskId(klingDataFromEnvelope(body));
  if (!reference) {
    console.warn("[ai/webhook-kling] unverified delivery with no task id — ignored", { reason: verdict.reason });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  if (!klingConfigured()) {
    // Nothing may be accepted without the means to check it. Loud on our side, silent on theirs.
    console.error("[ai/webhook-kling] no Kling credential on this deployment — an unverified delivery cannot be confirmed and is refused", { reason: verdict.reason });
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  console.warn("[ai/webhook-kling] unverified delivery — confirming with the provider before acting", { reason: verdict.reason, secretConfigured: !!secret });

  let state = null;
  try {
    const data = await klingGetTask(reference);
    state = data ? stateFromKlingTask(data) : null;
  } catch (e) {
    /*
      A read that failed is OUR side being unable to confirm, which a retry
      can fix — so this is one of the few 500s here, and Kling redelivering is
      exactly the behaviour we want.
    */
    console.error("[ai/webhook-kling] could not confirm an unverified delivery with the provider", { detail: String(e).slice(0, 300) });
    return NextResponse.json({ ok: false, retry: true }, { status: 500 });
  }

  if (!state) {
    // The vendor does not report this task as ours, or reports a status we do not know. Nothing to do, and no retry will change it.
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const answer = await handleProviderCallback(state, { provider: "kling", log: "ai/webhook-kling" });
  return NextResponse.json(answer.body, { status: answer.status });
}
