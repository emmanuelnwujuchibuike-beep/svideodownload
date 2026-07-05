import { NextResponse } from "next/server";

import { DEFAULT_CAPTION_LANGUAGES, generateStreamCaptionsMulti } from "@/lib/media/stream";
import { verifyStreamWebhookSignature } from "@/lib/media/stream-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WEBHOOK_SECRET = process.env.CF_STREAM_WEBHOOK_SECRET?.trim();

interface StreamWebhookPayload {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string; errorReasonText?: string; errorReasonCode?: string };
}

/**
 * Cloudflare Stream account webhook — fires once per video when it finishes
 * processing (ready or error). More reliable than assuming it's ready right
 * after ingest: flips `stream_ready` so the player stops attempting HLS during
 * the brief transcode window (plain MP4 fallback plays meanwhile) and re-requests
 * any caption languages that didn't take the first time (Cloudflare can drop a
 * captions request made before the video finished processing).
 *
 * Register once via POST /api/admin/stream-webhook-setup, then set the returned
 * secret as `CF_STREAM_WEBHOOK_SECRET`. Always resolves quickly and acks with 200
 * even for videos we don't recognize, so Cloudflare never retry-storms us; the
 * only rejection is a signature that doesn't verify.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!WEBHOOK_SECRET || !verifyStreamWebhookSignature(raw, request.headers.get("webhook-signature"), WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 403 });
  }

  let payload: StreamWebhookPayload;
  try {
    payload = JSON.parse(raw) as StreamWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad payload." }, { status: 400 });
  }

  const uid = payload.uid;
  if (!uid) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  const { data: post } = await db
    .from("posts")
    .select("id, caption_languages")
    .eq("stream_uid", uid)
    .maybeSingle();
  if (!post) return NextResponse.json({ ok: true }); // not one of ours (or deleted) — ack anyway

  if (payload.status?.state === "error") {
    await db
      .from("posts")
      .update({
        stream_ready: false,
        stream_error: payload.status.errorReasonText || payload.status.errorReasonCode || "encode-error",
      })
      .eq("id", post.id);
    return NextResponse.json({ ok: true });
  }

  if (payload.readyToStream) {
    await db.from("posts").update({ stream_ready: true, stream_error: null }).eq("id", post.id);

    const have = new Set<string>((post.caption_languages as string[] | null) ?? []);
    const missing = DEFAULT_CAPTION_LANGUAGES.filter((l) => !have.has(l));
    if (missing.length) {
      const gained = await generateStreamCaptionsMulti(uid, missing);
      if (gained.length) {
        await db
          .from("posts")
          .update({ caption_languages: [...have, ...gained] })
          .eq("id", post.id);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
