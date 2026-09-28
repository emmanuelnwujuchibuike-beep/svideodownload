import { KLING_OK_CODE, type KlingBillingLine, type KlingEnvelope, type KlingTaskData, type KlingTaskResult } from "@/lib/ai/kling/config";
import type { AiJobStatus } from "@/lib/ai/jobs";
import type { AiProviderState } from "@/lib/ai/provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING'S VOCABULARY, TRANSLATED INTO OURS — at exactly one boundary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same discipline as `lib/ai/replicate/status.ts` and
 * `lib/ai/fal/status.ts`: the rest of FrenzSave never learns a vendor's words.
 * A job row, the history list, the progress screen and the admin monitor all
 * speak `AiJobStatus`, and this file is the only place that knows Kling says
 * "succeeded" where we say "completed".
 *
 *   submitted            → queued
 *   processing           → processing
 *   succeed / succeeded  → completed
 *   failed               → failed
 *   anything else        → null
 *
 * ── 🔴 CORRECTED 2026-09-28 (Part 4), AGAINST THE LIVE API ─────────────────
 *
 * Part 2 read the result from `task_result.videos[].url`. The live Omni surface
 * answers **`outputs[]`**, so a genuinely finished, genuinely paid video came
 * back from this file as "succeeded with no video in the task result" — a
 * completed job reported as a failure, and a refund for work the vendor had
 * already charged for. `task_result` is still read, because the legacy `/v1`
 * tree (which serves Lip Sync) does use it.
 *
 * Part 2 also read the failure reason from `task_status_msg`, which does not
 * exist on this surface; it is **`message`**.
 *
 * ── 🔴 AN UNKNOWN STATUS MAPS TO null, AND EVERY CALLER LEAVES THE JOB ALONE ─
 *
 * Copied deliberately from the Replicate mapper, where the reasoning is written
 * out: a vendor that adds a status we have never seen must not be guessed at.
 * Guessing "processing" strands a finished job; guessing "failed" refunds a job
 * that is still running and then has to be paid for twice. Doing nothing is the
 * only safe third answer, and the reconcile sweep will ask again in ten minutes.
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
  for (const value of [data.id, data.task_id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The task's status string, whichever field carries it. */
export function klingTaskStatusString(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  for (const value of [data.status, data.task_status]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The task's own explanation of itself. ✅ `message` on the Omni surface. */
export function klingTaskMessage(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  for (const value of [data.message, data.task_status_msg]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The caller's own handle, echoed back — the recovery key for a timed-out create. */
export function klingExternalTaskId(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;
  const direct = data.external_task_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = data.task_info?.external_task_id;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

const httpsUrl = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : null);

/**
 * The finished result, reduced to ONE video URL.
 *
 * ✅ `outputs[]` is the Omni surface's answer, verified live:
 * `[{ "type": "video", "id": "…", "url": "https://…", "duration": "5.041" }]`.
 * `task_result.videos[]` is the legacy `/v1` tree's answer and is read second
 * so one function serves both the Omni and the Lip Sync endpoints.
 *
 * Only https is accepted — an output URL is about to be fetched by our worker.
 */
export function extractKlingVideoUrl(data: KlingTaskData | null | undefined): string | null {
  if (!data) return null;

  if (Array.isArray(data.outputs)) {
    // A `type` of "video" wins; an untyped entry is accepted rather than dropped.
    for (const output of data.outputs) {
      if (!output || typeof output !== "object") continue;
      if (output.type !== undefined && output.type !== "video") continue;
      const url = httpsUrl(output.url);
      if (url) return url;
    }
  }
  return extractKlingVideoUrlFromResult(data.task_result);
}

/** The legacy `/v1` result envelope, read defensively — the lip-sync surface uses it. */
export function extractKlingVideoUrlFromResult(result: KlingTaskResult | null | undefined): string | null {
  if (!result || typeof result !== "object") return null;

  if (Array.isArray(result.videos)) {
    for (const video of result.videos) {
      const url = video && typeof video === "object" ? httpsUrl(video.url) : httpsUrl(video);
      if (url) return url;
    }
  }
  const record = result as Record<string, unknown>;
  for (const key of ["video_url", "url"]) {
    const url = httpsUrl(record[key]);
    if (url) return url;
  }
  const video = record.video;
  if (video && typeof video === "object") {
    const url = httpsUrl((video as Record<string, unknown>).url);
    if (url) return url;
  }
  return null;
}

/** The output's duration in seconds, when the vendor reports one. Never billing input — the worker measures the file. */
export function extractKlingVideoDurationSeconds(data: KlingTaskData | null | undefined): number | null {
  const toSeconds = (raw: unknown): number | null => {
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (Array.isArray(data?.outputs)) {
    for (const output of data!.outputs) {
      if (!output || typeof output !== "object") continue;
      const seconds = toSeconds(output.duration);
      if (seconds !== null) return seconds;
    }
  }
  if (Array.isArray(data?.task_result?.videos)) {
    for (const video of data!.task_result!.videos!) {
      if (!video || typeof video !== "object") continue;
      const seconds = toSeconds(video.duration);
      if (seconds !== null) return seconds;
    }
  }
  return null;
}

/**
 * 🔴 WHAT THE VENDOR ACTUALLY CHARGED, in units.
 *
 * ✅ VERIFIED live: a 5 s / 720p text-to-video reported
 * `[{ "charge_type": "unit", "amount": "3", "package_type": "video" }]`, and a
 * task that failed before generating reported `[{ "amount": "0" }]`.
 *
 * This is the real provider-consumption figure, and it is the reason Kling's
 * cost model is a unit matrix rather than a per-second rate. It is recorded for
 * the operator (and for improving the matrix); it is **never** the member's
 * price. `lib/ai/kling/pricing.ts` owns what a member pays, the quote is signed
 * before the job starts, and nothing the vendor reports afterwards may change it.
 *
 * Returns null when the vendor reported nothing — which is not zero. A task
 * still running has no billing line at all, and treating "unknown" as "free"
 * would understate real spend in the admin's own figures.
 */
export function extractKlingBilledUnits(data: KlingTaskData | null | undefined): number | null {
  const lines: readonly KlingBillingLine[] | null | undefined = data?.billing;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  let total = 0;
  let sawOne = false;
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const raw = line.amount;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) continue;
    total += n;
    sawOne = true;
  }
  return sawOne ? total : null;
}

/**
 * One Kling task turned into our state.
 *
 * `modelVersion` is null on purpose: Kling addresses a model by name and
 * publishes no immutable version id per run, so writing anything there would be
 * an invention. The model NAME is already on the job row.
 *
 * Returns null when the payload is not a task at all — the caller answers 200
 * and changes nothing, exactly as the fal route does.
 */
export function stateFromKlingTask(data: KlingTaskData | null | undefined): AiProviderState | null {
  const reference = klingTaskId(data);
  if (!reference || !data) return null;

  const status = mapKlingTaskStatus(klingTaskStatusString(data));
  if (!status) return null;

  // Trimmed hard: this is stored for operators, and a vendor can put a great deal in an error field.
  const messageRaw = klingTaskMessage(data);
  const detail = messageRaw ? messageRaw.slice(0, 2000) : null;

  if (status === "completed") {
    const url = extractKlingVideoUrl(data);
    return {
      reference,
      status: "completed",
      modelVersion: null,
      resultUrl: url,
      // A success with nothing in it is a real outcome the handler knows how to end and refund.
      detail: url ? null : (detail ?? "succeeded with no video in the task output"),
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
 * 🔴 This function does NOT decide whether the body may be believed. The route
 * verifies the signature first, and a body it could not verify is discarded in
 * favour of an authenticated read. See the route's own note.
 */
export function stateFromKlingCallbackBody(body: unknown): AiProviderState | null {
  const data = klingDataFromEnvelope(body);
  return data ? stateFromKlingTask(data) : null;
}

/**
 * The `data` of an envelope, whether it holds one task or a list of them.
 *
 * ✅ `GET /tasks` answers an ARRAY; a create and a callback answer one object.
 * Both are unwrapped here so nothing above this line has to care.
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

/** Whether an envelope reports success. `code: 0` on every verified endpoint. */
export function klingEnvelopeOk(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const code = (body as KlingEnvelope).code;
  return code === undefined || code === KLING_OK_CODE;
}
