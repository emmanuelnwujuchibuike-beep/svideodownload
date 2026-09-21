import "server-only";

import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";

import { AiJobError } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FAL.AI — the one client, and the only file that reads FAL_KEY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fal.ai brief (§12): "Integrate fal.ai server-side. Use the official
 * @fal-ai/client package … Keep FAL_KEY server-side. Never expose it to the
 * browser, the frontend bundle, localStorage, public API responses or
 * client-side environment variables."
 *
 * `server-only` makes an import from a client component a build error. The
 * key is read from `process.env` inside `client()`, handed to the SDK as a
 * resolver (never copied onto a module constant), and never placed on a job
 * row, in a log line, in an error message or in anything returned to a
 * caller. A provider error body can quote request headers back, so bodies
 * are trimmed for OUR logs and never forwarded — the member gets a stable
 * error code and a written sentence (lib/ai/errors.ts).
 *
 * ── Queue only, never `run`/`subscribe` (§24 "webhook-first") ──────────────
 * `queue.submit` returns a request id the moment fal has accepted the work;
 * the outcome arrives at /api/webhooks/fal, and the reconciler asks
 * `queue.status` / `queue.result` only for a callback that went missing. A
 * request is never awaited inside an HTTP handler.
 */

const SUBMIT_TIMEOUT_MS = 20_000;

export function falConfigured(): boolean {
  return !!process.env.FAL_KEY?.trim();
}

let cached: FalClient | null = null;
function client(): FalClient {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new AiJobError("FEATURE_UNAVAILABLE", "FAL_KEY is not set");
  if (!cached) {
    cached = createFalClient({
      // A resolver, so a rotated key on a warm instance is picked up on the next call.
      credentials: () => process.env.FAL_KEY?.trim(),
      suppressLocalCredentialsWarning: true,
    });
  }
  return cached;
}

/** What the SDK's failure looks like once it is ours. */
export interface FalFailure {
  status: number | null;
  /** Trimmed for OUR logs. Never sent to a browser. */
  detail: string;
  /** 401/403 = the key; 402/429 = our account; 422 = the input; anything else = the provider. */
  kind: "credentials" | "account" | "input" | "provider";
}

export function classifyFalError(e: unknown): FalFailure {
  if (e instanceof ApiError) {
    const status = e.status;
    const body = (() => {
      try {
        return typeof e.body === "string" ? e.body : JSON.stringify(e.body);
      } catch {
        return "";
      }
    })();
    const detail = `fal ${status}: ${(body || e.message || "").slice(0, 500)}`;
    if (status === 401 || status === 403) return { status, detail, kind: "credentials" };
    if (status === 402 || status === 429) return { status, detail, kind: "account" };
    if (status === 422 || status === 400) return { status, detail, kind: "input" };
    return { status, detail, kind: "provider" };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { status: null, detail: `fal: ${message.slice(0, 500)}`, kind: "provider" };
}

/** The failure as the job's error: our account and our key are PROVIDER_UNAVAILABLE (a retry cannot help the member); a refused input is the job's. */
export function falErrorToJobError(f: FalFailure): AiJobError {
  if (f.kind === "credentials" || f.kind === "account") return new AiJobError("PROVIDER_UNAVAILABLE", f.detail);
  if (f.kind === "input") return new AiJobError("PROVIDER_ERROR", f.detail);
  return new AiJobError("PROVIDER_ERROR", f.detail);
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export interface FalSubmitResult {
  requestId: string;
  /** IN_QUEUE at submission, always — kept for the record. */
  status: string;
  queuePosition: number | null;
  /** How long fal took to ACCEPT the work — the health panel's latency. */
  latencyMs: number;
}

/**
 * Submit one request to a fal endpoint's queue. Returns the request id —
 * never the result. `webhookUrl` is where fal reports the outcome; an
 * endpoint id here is always one the OPERATOR configured (lib/ai/providers/
 * config.ts), never a value from a request.
 */
export async function falQueueSubmit(endpointId: string, input: Record<string, unknown>, opts: { webhookUrl: string; label: string; jobId?: string }): Promise<FalSubmitResult> {
  const started = Date.now();
  try {
    const res = await withTimeout(
      () => client().queue.submit(endpointId as never, { input: input as never, webhookUrl: opts.webhookUrl }),
      SUBMIT_TIMEOUT_MS,
    );
    if (!res?.request_id) throw new AiJobError("PROVIDER_ERROR", "fal accepted the request but returned no request id");
    return { requestId: res.request_id, status: res.status, queuePosition: typeof res.queue_position === "number" ? res.queue_position : null, latencyMs: Date.now() - started };
  } catch (e) {
    if (e instanceof AiJobError) throw e;
    const f = classifyFalError(e);
    console.error(`[ai/fal] ${opts.label} submit rejected`, { jobId: opts.jobId ?? null, endpoint: endpointId, status: f.status, kind: f.kind, detail: f.detail });
    throw falErrorToJobError(f);
  }
}

export type FalQueueState = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export async function falQueueStatus(endpointId: string, requestId: string): Promise<{ status: FalQueueState; queuePosition: number | null }> {
  try {
    const res = await withTimeout(() => client().queue.status(endpointId, { requestId }), SUBMIT_TIMEOUT_MS);
    return { status: res.status, queuePosition: "queue_position" in res && typeof res.queue_position === "number" ? res.queue_position : null };
  } catch (e) {
    const f = classifyFalError(e);
    throw falErrorToJobError(f);
  }
}

/** The finished request's output. A 4xx here after COMPLETED means the request failed on the provider's side. */
export async function falQueueResult(endpointId: string, requestId: string): Promise<{ data: unknown } | { failed: FalFailure }> {
  try {
    const res = await withTimeout(() => client().queue.result(endpointId, { requestId }), SUBMIT_TIMEOUT_MS);
    return { data: (res as { data?: unknown })?.data ?? res };
  } catch (e) {
    return { failed: classifyFalError(e) };
  }
}

export async function falQueueCancel(endpointId: string, requestId: string): Promise<boolean> {
  try {
    await withTimeout(() => client().queue.cancel(endpointId, { requestId }), SUBMIT_TIMEOUT_MS);
    return true;
  } catch {
    // A request that already finished cannot be cancelled; the caller records the member's intent either way.
    return false;
  }
}

/**
 * §27: does the key work, and is the endpoint one fal knows? A status read on
 * a request id that cannot exist answers 404 (or 422) when the key is good
 * and the endpoint exists, and 401/403 when the key is not — nothing is
 * submitted and nothing is billed.
 */
export async function falCredentialCheck(endpointId: string): Promise<{ ok: boolean; status: number | null; latencyMs: number; detail: string }> {
  const started = Date.now();
  if (!falConfigured()) return { ok: false, status: null, latencyMs: 0, detail: "FAL_KEY is not set on this deployment" };
  try {
    await withTimeout(() => client().queue.status(endpointId, { requestId: "00000000-0000-4000-8000-000000000000" }), SUBMIT_TIMEOUT_MS);
    return { ok: true, status: 200, latencyMs: Date.now() - started, detail: "reachable" };
  } catch (e) {
    const f = classifyFalError(e);
    const latencyMs = Date.now() - started;
    if (f.kind === "credentials") return { ok: false, status: f.status, latencyMs, detail: "fal.ai refused the key" };
    if (f.status === 404 || f.status === 422 || f.status === 400) return { ok: true, status: f.status, latencyMs, detail: "key accepted; endpoint reachable" };
    return { ok: false, status: f.status, latencyMs, detail: f.detail.slice(0, 200) };
  }
}
