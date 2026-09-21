import { NextResponse } from "next/server";

import { falWebhookKeys } from "@/lib/ai/fal/jwks";
import { readFalWebhookHeaders, verifyFalWebhook } from "@/lib/ai/fal/signature";
import { stateFromFalWebhookBody } from "@/lib/ai/fal/status";
import { handleProviderCallback } from "@/lib/ai/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/webhooks/fal — how a fal.ai job finishes (the fal.ai brief §15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Public, like the Replicate route, so the signature is the whole security
 * model: fal signs every delivery with an ED25519 key published as JWKS
 * (lib/ai/fal/signature.ts documents the scheme). The RAW body is read and
 * verified before anything parses it; a delivery that fails against the
 * cached keys is checked once more against a refreshed set (a rotation),
 * then refused with 200 — a forged delivery does not become genuine on a
 * retry, and 4xx would only make fal retry it up to 31 times.
 *
 * The body carries `request_id` (matched against the UNIQUE reference column
 * on ai_jobs), `status: "OK" | "ERROR"`, the `payload` (`{ video: { url } }`)
 * or the `error`. Normalised in lib/ai/fal/status.ts; from there the shared
 * handler runs the exact sequence the Replicate route runs — the same CAS
 * transitions, the same refund-once, the same worker hand-off — so a
 * duplicate delivery changes nothing and a member never learns which vendor
 * produced their video.
 */
export async function POST(request: Request) {
  // 🔴 text(), not json(). The signature covers the hash of these exact bytes.
  const rawBody = await request.text();
  const headers = readFalWebhookHeaders(request.headers);

  let keys = await falWebhookKeys();
  let verdict = verifyFalWebhook({ headers, rawBody, keys });
  if (!verdict.valid && (verdict.reason === "no-match" || verdict.reason === "no-keys")) {
    // A rotated key: refresh the set once, then decide.
    keys = await falWebhookKeys({ refresh: true });
    verdict = verifyFalWebhook({ headers, rawBody, keys });
  }
  if (!verdict.valid) {
    console.warn("[ai/webhook-fal] rejected", { reason: verdict.reason, keys: keys.length });
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const state = stateFromFalWebhookBody(body);
  if (!state) return NextResponse.json({ ok: false }, { status: 200 });
  // The signed header names the request too; a body claiming another id is not the delivery that was signed.
  if (headers.requestId && headers.requestId !== state.reference) {
    console.warn("[ai/webhook-fal] body/header request id mismatch", { header: headers.requestId, body: state.reference });
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const answer = await handleProviderCallback(state, { provider: "fal", log: "ai/webhook-fal" });
  return NextResponse.json(answer.body, { status: answer.status });
}
