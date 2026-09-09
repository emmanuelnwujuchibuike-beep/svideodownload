import "server-only";

import { AI_CLEAN_DETECTOR } from "@/lib/ai/config";
import { parseSuryaBoxes, type TextBox } from "@/lib/ai/text-detect";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SURYA — one frame in, text boxes out
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "fix the detector and wire it. Do this once and for all."
 *
 * The thin provider layer for `datalab-to/ocr`. Everything about WHAT to do
 * with the boxes lives in lib/ai/text-detect.ts, which is pure; this file only
 * knows how to ask.
 *
 * ── 🔴 THE FRAME GOES AS A DATA URI, AND THAT IS DELIBERATE ─────────────────
 *
 * The obvious alternative is to upload each sampled frame to storage and hand
 * Replicate a signed URL. That is what the video path does, and it is wrong
 * here: it would put six or eight objects into the member's own storage prefix
 * per job, each needing a signed URL, a retention entry and a delete — for a
 * JPEG that is wanted for thirteen seconds.
 *
 * A ~60 KB frame inline costs one base64 expansion (~80 KB) in a request body
 * on a worker that is already holding the whole video in memory. Nothing is
 * stored, so nothing has to be cleaned up, and no frame of the member's video
 * is ever reachable by URL.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 *
 * A detector failure must degrade to "no boxes from this frame", not to a
 * failed job. With several frames sampled per video, one bad call costs a
 * little coverage; an exception would cost the member their clean.
 */

const REPLICATE_API = "https://api.replicate.com/v1";

export interface SuryaResult {
  boxes: TextBox[];
  /** Null when the call did not complete. Used for diagnostics only. */
  predictSeconds: number | null;
  /** A short reason, for the job's diagnostics. Never shown to a member. */
  detail: string;
}

function authHeaders(): Record<string, string> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Detect text in ONE frame.
 *
 * 🔴 A hard deadline per frame, not just an overall one. Frames are detected in
 * parallel, so a single call that hangs would otherwise hold the whole
 * detection stage — and therefore the job — open until the worker's own
 * timeout. Losing one sample is a fair price for that.
 */
export async function detectTextInFrame(jpeg: Buffer): Promise<SuryaResult> {
  const startedAt = Date.now();
  const deadline = startedAt + AI_CLEAN_DETECTOR.frameTimeoutMs;

  let submitted: { id?: string; urls?: { get?: string } };
  try {
    const res = await fetch(`${REPLICATE_API}/predictions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: AI_CLEAN_DETECTOR.version,
        input: {
          file: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
          /*
            🔴 `return_pages` is what makes this useful at all. Without it the
            response carries the transcribed TEXT and no geometry — and we do
            not care what the caption says, only where it is.
          */
          return_pages: true,
          // No visualisation: it returns an annotated image we would download
          // and discard.
          visualize: false,
        },
      }),
    });
    if (!res.ok) {
      // 🔴 The status, never the body. A provider error body can echo the
      // request back, and the request carries a frame of somebody's video.
      return { boxes: [], predictSeconds: null, detail: `submit ${res.status}` };
    }
    submitted = await res.json();
  } catch (e) {
    const ours = e instanceof Error && /REPLICATE_API_TOKEN/.test(e.message);
    return {
      boxes: [],
      predictSeconds: null,
      detail: ours ? "no-token-on-worker" : "submit threw",
    };
  }

  const pollUrl = submitted.urls?.get ?? (submitted.id ? `${REPLICATE_API}/predictions/${submitted.id}` : null);
  if (!pollUrl) return { boxes: [], predictSeconds: null, detail: "no prediction id" };

  for (;;) {
    if (Date.now() > deadline) {
      // Best effort — an abandoned prediction keeps billing.
      if (submitted.id) {
        void fetch(`${REPLICATE_API}/predictions/${submitted.id}/cancel`, {
          method: "POST",
          headers: authHeaders(),
        }).catch(() => {});
      }
      return { boxes: [], predictSeconds: null, detail: "timed out" };
    }
    await new Promise((r) => setTimeout(r, AI_CLEAN_DETECTOR.pollMs));

    let poll: { status?: string; output?: unknown; metrics?: { predict_time?: number } };
    try {
      const res = await fetch(pollUrl, { headers: authHeaders() });
      poll = await res.json();
    } catch {
      continue; // a dropped poll is not a failed detection
    }

    if (poll.status === "succeeded") {
      return {
        boxes: parseSuryaBoxes(poll.output, { minConfidence: AI_CLEAN_DETECTOR.minConfidence }),
        predictSeconds: poll.metrics?.predict_time ?? null,
        detail: "ok",
      };
    }
    if (poll.status === "failed" || poll.status === "canceled") {
      return { boxes: [], predictSeconds: null, detail: `provider ${poll.status}` };
    }
  }
}
