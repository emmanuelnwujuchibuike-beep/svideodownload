import { KLING_OK_CODE, type KlingEnvelope, type KlingTaskData, type KlingTaskResult } from "@/lib/ai/kling/config";
import type { AiJobStatus } from "@/lib/ai/jobs";
import type { AiProviderState } from "@/lib/ai/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING'S VOCABULARY, TRANSLATED INTO OURS — at exactly one boundary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same discipline as `lib/ai/replicate/status.ts` and
 * `lib/ai/fal/status.ts`: the rest of FrenzSave never learns a vendor's
 * words. A job row, the history list, the progress screen and the admin
 * monitor all speak `AiJobStatus`, and this file is the only place that knows
 * Kling says "succeed" where we say "completed".
 *
 *   submitted            → queued
 *   processing           → processing
 *   succeed / succeeded  → completed
 *   failed               → failed
 *   anything else        → null
 *
 * ── 🔴 AN UNKNOWN STATUS MAPS TO null, AND EVERY CALLER LEAVES THE JOB ALONE ─
 *
 * Copied deliberately from the Replicate mapper, where the reasoning is
 * written out: a vendor that adds a status we have never seen must not be
 * guessed at. Guessing "processing" strands a finished job; guessing
 * "failed" refunds a job that is still running and then has to be paid for
 * twice. Doing nothing is the only safe third answer, and the reconcile
 * sweep will ask again in ten minutes.
 */
export function mapKlingTaskStatus(status: string | null | undefined): AiJobStatus | null {
  if (!status) return null;
  switch (status.trim().toLowerCase()) {
    case "submitted":
    case "pending":
    case "queued":
      return "queued";
    case "processing":
    case "running":
      return "processing";
    case "succeed":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
      return "failed";
    default:
      return null;
  }
}

/** The task's own id, whichever of the two field names this surface uses. */
export function klingTaskId(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  for (const value of [data.task_id, data.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The task's status string, whichever field carries it. */
export function klingTaskStatusString(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  for (const value of [data.task_status, data.status]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The caller's own handle, echoed back — the recovery key described in §14. */
export function klingExternalTaskId(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  const direct = data.external_task_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = data.task_info?.external_task_id;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

/**
 * The finished result, reduced to ONE video URL.
 *
 * `task_result.videos[]` is what every documented Kling video endpoint
 * answers. The extra shapes below are read defensively, the same way the fal
 * extractor is: a vendor that renames one field should cost us a reconcile
 * cycle, not a refund. Only https is accepted — an output URL is about to be
 * fetched by our worker.
 */
export function extractKlingVideoUrl(result: KlingTaskResult | null | undefined): string | null {
  const asUrl = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null);
  if (!result || typeof result !== "object") return null;

  if (Array.isArray(result.videos)) {
    for (const video of result.videos) {
      const url = video && typeof video === "object" ? asUrl(video.url) : asUrl(video);
      if (url) return url;
    }
  }
  const record = result as Record<string, unknown>;
  for (const key of ["video_url", "url"]) {
    const url = asUrl(record[key]);
    if (url) return url;
  }
  const video = record.video;
  if (video && typeof video === "object") {
    const url = asUrl((video as Record<string, unknown>).url);
    if (url) return url;
  }
  return null;
}

/** The output's duration in seconds, when the vendor reports one. Never billing input — the worker measures the file. */
export function extractKlingVideoDurationSeconds(result: KlingTaskResult | null | undefined): number | null {
  if (!result || !Array.isArray(result.videos)) return null;
  for (const video of result.videos) {
    if (!video || typeof video !== "object") continue;
    const raw = video.duration;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * One Kling task turned into our state.
 *
 * `modelVersion` is null on purpose: Kling addresses a model by name and
 * publishes no immutable version id per run, so writing anything there would
 * be an invention. The model NAME is already on the job row.
 *
 * Returns null when the payload is not a task at all — the caller answers 200
 * and changes nothing, exactly as the fal route does.
 */
export function stateFromKlingTask(data: KlingTaskData | null | undefined): AiProviderState | null {
  const reference = klingTaskId(data);
  if (!reference || !data) return null;

  const status = mapKlingTaskStatus(klingTaskStatusString(data));
  if (!status) return null;

  const detailRaw = typeof data.task_status_msg === "string" ? data.task_status_msg.trim() : "";
  // Trimmed hard: this is stored for operators, and a vendor can put a great deal in an error field.
  const detail = detailRaw ? detailRaw.slice(0, 2000) : null;

  if (status === "completed") {
    const url = extractKlingVideoUrl(data.task_result);
    return {
      reference,
      status: "completed",
      modelVersion: null,
      resultUrl: url,
      // A success with nothing in it is a real outcome the handler knows how to end and refund.
      detail: url ? null : (detail ?? "succeeded with no video in the task result"),
    };
  }

  return { reference, status, modelVersion: null, resultUrl: null, detail: status === "failed" ? (detail ?? "provider failed") : null };
}

/**
 * A callback body turned into our state.
 *
 * The delivery carries the same envelope as a query — `{ code, message,
 * request_id, data }` — so the two paths share one mapper and a duplicate
 * callback produces exactly the state a reconcile read would.
 *
 * 🔴 This function does NOT decide whether the body may be believed. The
 * route verifies the signature first, and a body it could not verify is
 * discarded in favour of an authenticated read. See the route's own note.
 */
export function stateFromKlingCallbackBody(body: unknown): AiProviderState | null {
  const data = klingDataFromEnvelope(body);
  return data ? stateFromKlingTask(data) : null;
}

/**
 * The `data` of an envelope, whether it holds one task or a list of them.
 *
 * The unified `GET /tasks` answers an array; a create and a callback answer
 * one object. Both are unwrapped here so nothing above this line has to care.
 */
export function klingDataFromEnvelope(body: unknown): KlingTaskData | null {
  if (!body || typeof body !== "object") return null;
  const envelope = body as KlingEnvelope<KlingTaskData | KlingTaskData[]>;

  // A non-zero code is the vendor saying the REQUEST failed. That is the client's to classify, not a task state.
  if (typeof envelope.code === "number" && envelope.code !== KLING_OK_CODE) return null;

  const data = envelope.data;
  if (Array.isArray(data)) return data.find((t) => !!klingTaskId(t)) ?? null;
  if (data && typeof data === "object") return data;

  // Some surfaces answer the task at the top level, with no envelope at all.
  const bare = body as KlingTaskData;
  return klingTaskId(bare) ? bare : null;
}

/** Whether an envelope reports success. `code: 0` on every documented endpoint. */
export function klingEnvelopeOk(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const code = (body as KlingEnvelope).code;
  return code === undefined || code === KLING_OK_CODE;
}
