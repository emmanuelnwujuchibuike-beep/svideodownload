import "server-only";

import { AI_CLEAN_PROPAINTER } from "@/lib/ai/config";
import { propainterResizeRatio } from "@/lib/ai/propainter-plan";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROPAINTER — the reconstruction half of the ProPainter engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Called by the worker's finalizer, never by a route. It runs SYNCHRONOUSLY —
 * submit, then poll to completion — which is only acceptable because it runs on
 * the long-lived Railway worker rather than a serverless function. The job sits
 * in `finalizing` for the duration, which is honest, and the stall guard's
 * 60-minute `finalizing` deadline is the backstop.
 *
 * ── 🔴 WHY NOT A SECOND WEBHOOK ─────────────────────────────────────────────
 *
 * A webhook would mean a second provider stage in the job state machine: a new
 * status, a new signature check, new idempotency, and a new way for a job to
 * get stuck between stages. Polling from a machine that is already awake and
 * already holding both files on disk costs one HTTP request every few seconds
 * and adds no new state at all. The measured inference is ~210s.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * No retries. A failure here falls back to the detection model's own output,
 * which is a usable video — worse-looking, but present. Retrying a 210-second
 * GPU call on a member who is already waiting trades their time for a small
 * chance of a better picture, and doubles the bill when it fails again.
 */

const REPLICATE_API = "https://api.replicate.com/v1";

export interface ProPainterRequest {
  /** Signed, short-lived URL to the member's original. */
  videoUrl: string;
  /** Signed, short-lived URL to the mask the worker just built. */
  maskUrl: string;
  /**
   * 🔴 The SOURCE frame rate. ProPainter's `save_fps` defaults to 24, so
   * leaving it unset silently resamples a 30fps video and changes its duration.
   * Caught in the prototype before it ever ran on a member's file.
   */
  fps: number;
  /**
   * The source frame size, used only to pick a `resize_ratio` that fits in GPU
   * memory. Null when the probe could not read it — see `propainterResizeRatio`
   * for what happens then.
   */
  width?: number | null;
  height?: number | null;
}


export type ProPainterResult =
  | { ok: true; outputUrl: string; predictTimeSeconds: number | null }
  | { ok: false; reason: string };

function authHeaders(): Record<string, string> {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("REPLICATE_API_TOKEN is not set");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * Run one reconstruction. Resolves either way; never throws for a provider
 * failure, because the caller has a usable fallback and should take it.
 */
export async function runProPainter(req: ProPainterRequest): Promise<ProPainterResult> {
  const startedAt = Date.now();
  const resizeRatio = propainterResizeRatio(req.width, req.height, AI_CLEAN_PROPAINTER.maxPixels);
  if (resizeRatio < 1) {
    // Worth a line: it is the difference between "this job was reconstructed at
    // native size" and "at two thirds", and the row's diagnostics carry it too.
    console.info("[ai/propainter] reducing for GPU memory", {
      source: `${req.width}x${req.height}`,
      resizeRatio,
      budget: AI_CLEAN_PROPAINTER.maxPixels,
    });
  }

  let submitted: { id?: string; error?: unknown };
  try {
    const res = await fetch(`${REPLICATE_API}/predictions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        version: AI_CLEAN_PROPAINTER.version,
        input: {
          video: req.videoUrl,
          mask: req.maskUrl,
          mode: "video_inpainting",
          save_fps: req.fps,
          mask_dilation: AI_CLEAN_PROPAINTER.maskDilation,
          /*
            🔴 1 FOR ANYTHING THAT FITS, LESS FOR ANYTHING THAT DOES NOT.

            This was a hard-coded 1, and three consecutive jobs died of CUDA OOM
            inside RAFT because of it. See `propainterResizeRatio` above for the
            arithmetic — the short version is that optical flow costs area
            SQUARED and runs outside the chunking `subvideo_length` controls, so
            the chunk settings below could never have prevented it.

            Small clips are untouched: a 480x854 video is under budget and still
            gets a ratio of exactly 1.
          */
          resize_ratio: resizeRatio,
          /*
            🔴 STILL -1/-1. `width`/`height` are an absolute override that would
            ignore the source's aspect ratio; `resize_ratio` scales both
            together, which is the only form of reduction that does not distort
            somebody's video.
          */
          width: -1,
          height: -1,
          subvideo_length: AI_CLEAN_PROPAINTER.subvideoLength,
          neighbor_length: AI_CLEAN_PROPAINTER.neighborLength,
          ref_stride: AI_CLEAN_PROPAINTER.refStride,
          fp16: AI_CLEAN_PROPAINTER.fp16,
        },
      }),
    });
    submitted = await res.json();
    if (!res.ok || !submitted.id) {
      // 🔴 The status, not the body. A provider error body can carry the
      // request back verbatim, and the request contains SIGNED URLs.
      return { ok: false, reason: `submit failed: HTTP ${res.status}` };
    }
  } catch (e) {
    /*
      ── 🔴 REPORT OUR OWN ERROR'S MESSAGE, NOT JUST ITS NAME ─────────────────

      This said `e.name`, which for a plain `new Error(...)` is the string
      "Error" and nothing else. The owner's jobs failed for two days with
      `propainter: "failed: submit threw: Error"` recorded on every one of them
      — a diagnostic that names no cause, points at no fix, and cost a whole
      round trip to work out.

      The actual cause was `authHeaders()` throwing "REPLICATE_API_TOKEN is not
      set": the ProPainter call runs on the Docker WORKER, and the worker does
      not hold that credential. Every word needed to know that was in the
      message that was thrown away.

      ⚠️ Still never the RESPONSE body — a provider error body can echo the
      request back verbatim, and the request carries signed URLs. The rule is
      "ours is safe to log, theirs is not", so an Error we constructed here is
      surfaced and everything else stays a name.
    */
    const ours = e instanceof Error && /REPLICATE_API_TOKEN/.test(e.message);
    return {
      ok: false,
      reason: ours
        ? `submit threw: ${(e as Error).message} — this call runs on the WORKER, so the token must be set there too`
        : `submit threw: ${e instanceof Error ? e.name : "unknown"}`,
    };
  }

  const id = submitted.id;
  for (;;) {
    if (Date.now() - startedAt > AI_CLEAN_PROPAINTER.timeoutMs) {
      // Best effort — an abandoned prediction keeps billing otherwise.
      void fetch(`${REPLICATE_API}/predictions/${id}/cancel`, { method: "POST", headers: authHeaders() }).catch(() => {});
      return { ok: false, reason: "timed out waiting for reconstruction" };
    }
    await new Promise((r) => setTimeout(r, 6_000));

    let poll: {
      status?: string;
      output?: unknown;
      error?: unknown;
      metrics?: { predict_time?: number };
    };
    try {
      const res = await fetch(`${REPLICATE_API}/predictions/${id}`, { headers: authHeaders() });
      poll = await res.json();
    } catch {
      continue; // a dropped poll is not a failed job
    }

    if (poll.status === "succeeded") {
      /*
        The schema says an ARRAY of uris. Take the mp4 — a run configured with
        `return_input_video` would put two files here, and picking [0] blindly
        could return the member their own video back, unchanged, as a success.
      */
      const list = Array.isArray(poll.output) ? poll.output : [poll.output];
      const url = list.map(String).find((u) => /\.mp4(\?|$)/i.test(u)) ?? (list.length === 1 ? String(list[0]) : null);
      if (!url || !/^https:\/\//i.test(url)) return { ok: false, reason: "succeeded with no usable output" };
      return { ok: true, outputUrl: url, predictTimeSeconds: poll.metrics?.predict_time ?? null };
    }
    if (poll.status === "failed" || poll.status === "canceled") {
      return { ok: false, reason: `provider ${poll.status}` };
    }
  }
}
