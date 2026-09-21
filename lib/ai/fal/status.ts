import type { AiJobStatus } from "@/lib/ai/jobs";
import type { AiProviderState } from "@/lib/ai/provider";

/**
 * fal's vocabulary, translated into ours — at exactly one boundary, like
 * lib/ai/replicate/status.ts. The interface never learns a provider's words.
 *
 *   queue status   IN_QUEUE → queued · IN_PROGRESS → processing · COMPLETED → (the result decides)
 *   webhook        status "OK" + a video → completed · status "ERROR" → failed
 *                  status "OK" with `payload_error` (not serialisable) → completed with no output,
 *                  which the handler ends as "succeeded with no usable output" and refunds.
 *
 * An unknown status maps to null and every caller leaves the job alone.
 */
export function mapFalQueueStatus(status: string | null | undefined): AiJobStatus | null {
  if (!status) return null;
  const s = status.trim().toUpperCase();
  if (s === "IN_QUEUE") return "queued";
  if (s === "IN_PROGRESS") return "processing";
  if (s === "COMPLETED") return "completed";
  return null;
}

/** The finished payload, reduced to one video URL. Every fal video endpoint used here answers `{ video: { url } }` (I2VOutput). */
export function extractFalVideoUrl(payload: unknown): string | null {
  const fromString = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null);
  if (!payload || typeof payload !== "object") return fromString(payload);
  const p = payload as Record<string, unknown>;
  const video = p.video;
  if (video && typeof video === "object") {
    const url = fromString((video as Record<string, unknown>).url);
    if (url) return url;
  }
  for (const key of ["video_url", "url", "output"]) {
    const found = fromString(p[key]);
    if (found) return found;
  }
  if (Array.isArray(p.videos)) {
    for (let i = p.videos.length - 1; i >= 0; i--) {
      const v = p.videos[i] as Record<string, unknown> | string;
      const found = typeof v === "string" ? fromString(v) : v && typeof v === "object" ? fromString(v.url) : null;
      if (found) return found;
    }
  }
  return null;
}

/** Output facts the payload carries (Sync-3 reports them), for the finalizer's expectation check. */
export function extractFalVideoFacts(payload: unknown): { width: number | null; height: number | null; fps: number | null; durationSeconds: number | null; contentType: string | null; bytes: number | null } {
  const video = payload && typeof payload === "object" ? ((payload as Record<string, unknown>).video as Record<string, unknown> | undefined) : undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    width: n(video?.width),
    height: n(video?.height),
    fps: n(video?.fps),
    durationSeconds: n(video?.duration),
    contentType: typeof video?.content_type === "string" ? video.content_type : null,
    bytes: n(video?.file_size),
  };
}

export interface FalWebhookBody {
  request_id?: string;
  gateway_request_id?: string;
  status?: string;
  payload?: unknown;
  error?: unknown;
  payload_error?: unknown;
}

/** A verified webhook body in our vocabulary; null when it is not a fal callback at all. */
export function stateFromFalWebhookBody(body: unknown, opts: { modelVersion?: string | null } = {}): AiProviderState | null {
  if (!body || typeof body !== "object") return null;
  const b = body as FalWebhookBody;
  if (typeof b.request_id !== "string" || !b.request_id) return null;
  const status = typeof b.status === "string" ? b.status.trim().toUpperCase() : "";
  if (status === "OK") {
    const url = extractFalVideoUrl(b.payload);
    const payloadError = b.payload_error === undefined || b.payload_error === null ? null : String(typeof b.payload_error === "string" ? b.payload_error : JSON.stringify(b.payload_error)).slice(0, 2000);
    return { reference: b.request_id, status: "completed", modelVersion: opts.modelVersion ?? null, resultUrl: url, detail: url ? null : (payloadError ?? "succeeded with no video in the payload") };
  }
  if (status === "ERROR") {
    const detail = b.error === undefined || b.error === null ? null : String(typeof b.error === "string" ? b.error : JSON.stringify(b.error));
    const more = b.payload && typeof b.payload === "object" ? JSON.stringify(b.payload) : "";
    return { reference: b.request_id, status: "failed", modelVersion: opts.modelVersion ?? null, resultUrl: null, detail: [detail, more].filter(Boolean).join(" · ").slice(0, 2000) || "provider failed" };
  }
  return null;
}

/** Where a fal output may be fetched FROM (defence in depth, like the Replicate delivery hosts). */
export function isFalOutputHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "fal.media" || host.endsWith(".fal.media") || host === "fal.run" || host.endsWith(".fal.run") || host.endsWith(".fal.ai");
}
