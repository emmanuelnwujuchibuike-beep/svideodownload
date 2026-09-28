import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import {
  isDirectKlingBaseUrl,
  klingOmniVideoPath,
  KLING_CALLBACK_TOLERANCE_SECONDS,
  KLING_DEFAULT_BASE_URL,
  KLING_ERROR_CODES,
  KLING_LIP_SYNC_PATH,
  KLING_OK_CODE,
  KLING_TASKS_PATH,
  type KlingAuthMode,
  type KlingEnvelope,
  type KlingTaskData,
} from "@/lib/ai/kling/config";
import { klingJwt } from "@/lib/ai/kling/signature";
import { klingDataFromEnvelope, klingTaskId } from "@/lib/ai/kling/status";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING — the one client, and the only file that reads a Kling credential
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same posture as `lib/ai/fal/client.ts`, for the same reasons.
 *
 * `server-only` makes an import from a client component a BUILD error, so no
 * bundle can ever carry this module. Every credential is read from
 * `process.env` inside the function that uses it — never copied onto a module
 * constant, never placed on a job row, in a log line, in an error message or
 * in anything returned to a caller. A vendor error body can quote request
 * headers back, so bodies are trimmed for OUR logs and never forwarded: the
 * member gets a stable code and a written sentence (lib/ai/errors.ts).
 *
 * ── 🔴 THE CREDENTIAL LIVES ON THE FRONTEND, AND ONLY THERE (§7) ────────────
 *
 * The Part 1 audit recorded the boundary this project already keeps:
 *
 *     worker  ──POST /api/internal/ai/submit (x-worker-secret)──▶  frontend
 *     frontend ──────────────────────────────────────────────────▶  provider
 *
 * The Docker worker holds ffmpeg, yt-dlp and the ONNX models; it holds NO
 * provider token, deliberately, so a second host never has to be trusted with
 * something that spends money. Kling changes nothing about that. When Part 3
 * gives a feature a Kling handler, the worker will ask the frontend to submit
 * exactly as it asks today — `dispatchProviderSubmit`, unchanged.
 *
 * ── Never awaited inside a member's request ────────────────────────────────
 *
 * `createTask` returns the moment Kling has ACCEPTED the work and hands back
 * a task id; the outcome arrives at /api/webhooks/kling, and `getTask` is for
 * the reconciler when a callback goes missing. Nothing here waits for a video.
 */

/** Long enough for Kling to accept or refuse; never long enough to generate. */
const REQUEST_TIMEOUT_MS = 20_000;

/* ─────────────────────────── credentials ─────────────────────────────────── */

const env = (name: string): string => process.env[name]?.trim() || "";

/**
 * Which scheme this deployment can use.
 *
 * The API key wins when both are present: it is the new-standard surface the
 * 3.x models live on, and one maintained client reports those endpoints
 * refusing AccessKey/SecretKey outright (`1002`). An operator who wants the
 * legacy surface sets only the AK/SK pair.
 */
export function klingAuthMode(): KlingAuthMode | null {
  if (env("KLING_API_KEY")) return "api_key";
  if (env("KLING_ACCESS_KEY") && env("KLING_SECRET_KEY")) return "jwt";
  return null;
}

export function klingConfigured(): boolean {
  return klingAuthMode() !== null;
}

/** The base URL, refused unless it is one of Kling's OWN hosts over https (§5). */
export function klingBaseUrl(): string {
  const configured = env("KLING_API_BASE_URL");
  const base = (configured || KLING_DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!isDirectKlingBaseUrl(base)) {
    throw new AiJobError("FEATURE_UNAVAILABLE", `kling: ${configured ? "KLING_API_BASE_URL is not one of Kling's own API hosts" : "the default base URL is not a direct Kling host"} — this integration talks to Kling directly, never through an aggregator`);
  }
  return base;
}

/**
 * The `Authorization` value for one request.
 *
 * 🔴 Returns the header value, not the credential, and the JWT is minted per
 * call rather than cached: a thirty-minute token held on a warm serverless
 * instance is a thirty-minute window in which a rotated key still works.
 */
function authorization(): string {
  const mode = klingAuthMode();
  if (mode === "api_key") return `Bearer ${env("KLING_API_KEY")}`;
  if (mode === "jwt") return `Bearer ${klingJwt({ accessKey: env("KLING_ACCESS_KEY"), secretKey: env("KLING_SECRET_KEY") })}`;
  throw new AiJobError("FEATURE_UNAVAILABLE", "kling: no credential is set on this deployment (KLING_API_KEY, or KLING_ACCESS_KEY + KLING_SECRET_KEY)");
}

/* ───────────────────────────── failures ──────────────────────────────────── */

/** What a Kling failure looks like once it is ours. */
export interface KlingFailure {
  /** The HTTP status, or null when nothing was answered at all. */
  status: number | null;
  /** The vendor's own code from the envelope, when there was one. */
  code: number | null;
  /** Trimmed for OUR logs. Never sent to a browser. */
  detail: string;
  /** 401/403 = the credential; 429/1303 + 402 = our account; 400/422 = the input; anything else = the provider. */
  kind: "credentials" | "account" | "input" | "provider" | "network";
}

export function classifyKlingResponse(status: number, body: unknown, text: string): KlingFailure {
  const code = typeof (body as KlingEnvelope | undefined)?.code === "number" ? (body as KlingEnvelope).code! : null;
  const message = typeof (body as KlingEnvelope | undefined)?.message === "string" ? (body as KlingEnvelope).message! : "";
  const detail = `kling ${status}${code === null ? "" : `/${code}`}: ${(message || text || "").slice(0, 500)}`;

  // 1002 is the vendor saying this surface does not accept AccessKey/SecretKey — a configuration fault, not a job fault.
  if (code === KLING_ERROR_CODES.AK_SK_NOT_SUPPORTED) return { status, code, detail, kind: "credentials" };
  if (code === KLING_ERROR_CODES.CONCURRENCY_LIMIT) return { status, code, detail, kind: "account" };
  if (status === 401 || status === 403) return { status, code, detail, kind: "credentials" };
  if (status === 402 || status === 429) return { status, code, detail, kind: "account" };
  if (status === 400 || status === 422) return { status, code, detail, kind: "input" };
  return { status, code, detail, kind: "provider" };
}

/**
 * The failure as the JOB's error.
 *
 * Our key and our account are `PROVIDER_UNAVAILABLE` — a retry cannot help
 * the member and the copy says so. A refused input is `PROVIDER_ERROR`. This
 * is the same split the fal client makes, so a job's error code means the
 * same thing whichever vendor produced it.
 */
export function klingErrorToJobError(f: KlingFailure): AiJobError {
  if (f.kind === "credentials" || f.kind === "account") return new AiJobError("PROVIDER_UNAVAILABLE", f.detail);
  if (f.kind === "network") return new AiJobError("PROVIDER_TIMEOUT", f.detail);
  return new AiJobError("PROVIDER_ERROR", f.detail);
}

/* ─────────────────────────────── the call ────────────────────────────────── */

interface KlingResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}

/**
 * The one HTTP call to Kling.
 *
 * Exported so the credential check and any Part 3 feature handler share the
 * token, the timeout, the direct-host guard and the failure classification —
 * kept here so a handful of handlers cannot drift on any of it.
 */
export async function klingCall(path: string, init: { method: "GET" | "POST"; body?: string; signal?: AbortSignal }): Promise<KlingResponse> {
  const url = `${klingBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: init.method,
    signal: init.signal,
    headers: {
      // 🔴 The only place a credential leaves this process, and it leaves as a header to Kling's own host.
      authorization: authorization(),
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is a provider fault the caller reports with the status */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } catch (e) {
    if (e instanceof AiJobError) throw e;
    const aborted = e instanceof Error && e.name === "AbortError";
    const failure: KlingFailure = { status: null, code: null, detail: aborted ? `kling: ${label} did not answer within ${ms}ms` : `kling: ${label} — ${String(e).slice(0, 300)}`, kind: "network" };
    throw klingErrorToJobError(failure);
  } finally {
    clearTimeout(timer);
  }
}

/* ──────────────────────────── creating a task ────────────────────────────── */

export interface KlingCreateResult {
  taskId: string;
  /** The vendor's status at acceptance — `submitted`, normally. Kept for the record. */
  status: string | null;
  /** How long Kling took to ACCEPT the work — the health panel's latency. */
  latencyMs: number;
  /** The handle we sent, echoed back when the surface supports it (§14). */
  externalTaskId: string | null;
}

export interface KlingCreateTaskOptions {
  /** The model, which is a PATH SEGMENT on the Omni surface — always one of KLING_MODELS, never a request value. */
  model: string;
  /**
   * The create path, when it is not the Omni one. Lip Sync is its own endpoint
   * (`/v1/videos/lip-sync`) with its own request shape, so its handler names the
   * path rather than having this function guess from the model.
   *
   * 🔴 A path is never built from caller input — a handler passes one of the
   * constants in `config.ts`.
   */
  path?: string;
  /** The feature handler's own body. Part 2 ships no handler; Part 3 builds one per feature. */
  input: Record<string, unknown>;
  /** Where Kling should report the outcome. Ours, https, and the same for every feature. */
  callbackUrl: string;
  /**
   * OUR handle for this work (§14).
   *
   * 🔴 The reason this exists is money. If a create times out, Kling may have
   * accepted and billed a task we never saw an id for. Re-submitting with a
   * fresh handle bills twice; re-submitting with the SAME handle lets the
   * vendor recognise it, and lets us find the original by asking. The job id
   * is the natural value and is what Part 3 should pass.
   *
   * ⚠️ `external_task_id` is documented on the legacy surface; it is not
   * confirmed on the Omni endpoint. It is therefore sent only when a caller
   * asks for it, and nothing here depends on it being echoed back.
   */
  externalTaskId?: string | null;
  /** For the log line. Never sent. */
  label: string;
  /** For the log line. Never sent. */
  jobId?: string | null;
}

/**
 * Submit one task to Kling and return its id — never the result.
 *
 * The shape of `input` belongs to the FEATURE, not here: this function adds
 * only the two fields every task needs whatever it generates (the callback
 * and, optionally, our handle) and refuses to let either be overridden by a
 * handler's body.
 */
export async function klingCreateTask(opts: KlingCreateTaskOptions): Promise<KlingCreateResult> {
  const started = Date.now();
  /*
    ── 🔴 ONE SURFACE, VERIFIED (Part 4) ─────────────────────────────────────

    Part 2 branched the path AND the body on the auth mode, because a mirror
    described a legacy `POST /v1/videos/omni` where the model travelled in the
    body as `model_name`. **That endpoint does not exist** — it answers 404 on
    Kling's own host. There is one Omni create path, the model is a path
    segment, and there is no `model_name` field anywhere in the request.
  */
  const path = opts.path ?? klingOmniVideoPath(opts.model);

  let callback: URL;
  try {
    callback = new URL(opts.callbackUrl);
  } catch {
    throw new AiJobError("PROVIDER_ERROR", "kling: the callback URL is not a URL");
  }
  // The vendor requires https for callbacks, and so do we — a plaintext callback is a forgeable one.
  if (callback.protocol !== "https:") throw new AiJobError("PROVIDER_ERROR", "kling: the callback URL must be https");

  /*
    ── 🔴 THE CALLBACK GOES IN `options`, AND THAT IS NOT COSMETIC ────────────

    Part 2 put `callback_url` at the TOP LEVEL. The live API ignores unknown
    top-level fields silently — it does not reject them — so such a request is
    accepted, generates, BILLS, and never calls back. Every job submitted that
    way would have hung until the stall sweep failed it, after the member had
    been charged. Verified against the real API on 2026-09-28.
  */
  const options: Record<string, unknown> = {
    ...(opts.input.options && typeof opts.input.options === "object" ? (opts.input.options as Record<string, unknown>) : {}),
    // 🔴 After the spread, so a feature handler can never take these over.
    callback_url: callback.toString(),
    ...(opts.externalTaskId ? { external_task_id: opts.externalTaskId } : {}),
  };
  const body: Record<string, unknown> = { ...opts.input, options };

  const res = await withTimeout((signal) => klingCall(path, { method: "POST", body: JSON.stringify(body), signal }), REQUEST_TIMEOUT_MS, "create");

  if (!res.ok || !klingEnvelopeSucceeded(res.json)) {
    const failure = classifyKlingResponse(res.status, res.json, res.text);
    console.error(`[ai/kling] ${opts.label} create rejected`, { jobId: opts.jobId ?? null, model: opts.model, status: failure.status, code: failure.code, kind: failure.kind, detail: failure.detail });
    throw klingErrorToJobError(failure);
  }

  const data = klingDataFromEnvelope(res.json);
  const taskId = klingTaskId(data);
  if (!taskId) {
    /*
      🔴 Accepted, billed, and we do not know what to call it.
      This is the one failure the external handle exists for: the task may be
      running right now. The error names that explicitly so an operator
      reading the log knows to reconcile rather than assume nothing happened.
    */
    console.error(`[ai/kling] ${opts.label} accepted but returned no task id — the task may exist and be billable`, { jobId: opts.jobId ?? null, model: opts.model, externalTaskId: opts.externalTaskId ?? null });
    throw new AiJobError("PROVIDER_ERROR", "kling accepted the request but returned no task id");
  }

  return {
    taskId,
    status: typeof data?.task_status === "string" ? data.task_status : typeof data?.status === "string" ? data.status : null,
    latencyMs: Date.now() - started,
    externalTaskId: opts.externalTaskId ?? null,
  };
}

function klingEnvelopeSucceeded(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const code = (json as KlingEnvelope).code;
  return code === undefined || code === KLING_OK_CODE;
}

/* ──────────────────────────── reading a task ─────────────────────────────── */

/**
 * One task's current state, straight from Kling.
 *
 * Used by the reconciler when a callback never arrived, and by the webhook
 * route when a delivery could not be verified — in that second case this read
 * is what makes the unverified body harmless, because the answer comes back
 * over OUR authenticated connection rather than from whoever posted.
 *
 * Answers null for a task Kling does not know, which is not an error: a
 * reference that matches nothing is a delivery about work that is not ours.
 */
export async function klingGetTask(taskId: string): Promise<KlingTaskData | null> {
  const id = taskId.trim();
  if (!id) return null;
  // Path/query safety: the id goes into a URL, and it arrives from a callback body on one of the two paths.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new AiJobError("PROVIDER_ERROR", "kling: refusing a task id that is not a plain identifier");

  /*
    ✅ The unified query, verified: `GET /tasks?task_ids=…` answers
    `{code:0,data:[…]}`, and `data: []` for a task it does not know — which is
    not an error, so it must not be read as one.
  */
  const res = await withTimeout((signal) => klingCall(`${KLING_TASKS_PATH}?task_ids=${encodeURIComponent(id)}`, { method: "GET", signal }), REQUEST_TIMEOUT_MS, "status");

  if (res.status === 404) return null;
  if (!res.ok || !klingEnvelopeSucceeded(res.json)) {
    const failure = classifyKlingResponse(res.status, res.json, res.text);
    throw klingErrorToJobError(failure);
  }
  const data = klingDataFromEnvelope(res.json);
  if (data) return data;

  /*
    Nothing under `/tasks`. A Lip Sync task was created on the legacy `/v1` tree
    and may only be queryable there, so that is asked SECOND rather than guessed
    at first — an unknown id on either surface is still honestly null.
  */
  const legacy = await withTimeout((signal) => klingCall(`${KLING_LIP_SYNC_PATH}/${encodeURIComponent(id)}`, { method: "GET", signal }), REQUEST_TIMEOUT_MS, "status (lip sync)").catch(() => null);
  if (!legacy || legacy.status === 404 || !legacy.ok || !klingEnvelopeSucceeded(legacy.json)) return null;
  return klingDataFromEnvelope(legacy.json);
}

/* ───────────────────────── the credential check ──────────────────────────── */

export interface KlingCredentialCheck {
  ok: boolean;
  mode: KlingAuthMode | null;
  status: number | null;
  latencyMs: number;
  /** A sentence for an operator. Never a secret, never a raw vendor body. */
  detail: string;
}

/**
 * Does the credential work? — the shape `lib/ai/providers/test.ts` uses for
 * the other vendors, and the same promise: **nothing is submitted and nothing
 * is billed.**
 *
 * A status read on a task id that cannot exist answers 404 (or a not-found
 * code) when the credential is good, and 401/403 when it is not. That is the
 * whole test.
 */
export async function klingCredentialCheck(): Promise<KlingCredentialCheck> {
  const started = Date.now();
  const mode = klingAuthMode();
  if (!mode) return { ok: false, mode: null, status: null, latencyMs: 0, detail: "No Kling credential is set on this deployment (KLING_API_KEY, or KLING_ACCESS_KEY + KLING_SECRET_KEY)." };

  /*
    ✅ VERIFIED 2026-09-28: with a good credential this exact request answers
    `200 {"code":0,"message":"SUCCEED","data":[]}` — the task does not exist, and
    saying so IS the successful answer. A bad credential answers 401/403. One
    query serves both auth modes, because there is only one task surface.
  */
  const probe = "0000000000000000";
  const path = `${KLING_TASKS_PATH}?task_ids=${probe}`;
  try {
    const res = await withTimeout((signal) => klingCall(path, { method: "GET", signal }), REQUEST_TIMEOUT_MS, "credential check");
    const latencyMs = Date.now() - started;
    if (res.ok) return { ok: true, mode, status: res.status, latencyMs, detail: "Kling accepted the credential." };
    const failure = classifyKlingResponse(res.status, res.json, res.text);
    if (failure.kind === "credentials") {
      return { ok: false, mode, status: res.status, latencyMs, detail: failure.code === KLING_ERROR_CODES.AK_SK_NOT_SUPPORTED ? "Kling refused the AccessKey/SecretKey pair on this surface — set KLING_API_KEY instead." : "Kling refused the credential." };
    }
    if (res.status === 404 || failure.kind === "input") return { ok: true, mode, status: res.status, latencyMs, detail: "Credential accepted; the task query is reachable." };
    return { ok: false, mode, status: res.status, latencyMs, detail: failure.detail.slice(0, 200) };
  } catch (e) {
    // The message is ours (built in withTimeout / klingBaseUrl), never a vendor body.
    return { ok: false, mode, status: null, latencyMs: Date.now() - started, detail: (e instanceof AiJobError ? (e.detail ?? e.message) : "Kling could not be reached.").slice(0, 200) };
  }
}

/** Re-exported so a route can quote the window without importing the config too. */
export { KLING_CALLBACK_TOLERANCE_SECONDS };
