import "server-only";

import { AI_CLEAN_CONFIG, aiCleanMisconfiguration, buildAiCleanInput } from "@/lib/ai/config";
import { AiJobError } from "@/lib/ai/errors";
import type { AiProvider, AiProviderState, AiProviderSubmission } from "@/lib/ai/provider";
import { extractOutputUrl, mapReplicateStatus } from "@/lib/ai/replicate/status";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLICATE — the adapter, and the only file that knows their API exists
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Implements the `AiProvider` seam declared in Part 2. Everything above it —
 * the routes, the job store, the interface — speaks in Frenz statuses and knows
 * nothing about predictions, versions or webhook payload shapes.
 *
 * ── 🔴 THE TOKEN LIVES HERE AND NOWHERE ELSE ─────────────────────────────────
 *
 * `server-only`, read from `process.env` inside the functions that use it, and
 * never placed on a job row, in a log line, in an error message or in anything
 * returned to a caller. A provider error body can quote request headers back,
 * so the body is read for our own logs and NEVER forwarded to a client — the
 * member gets `PROVIDER_ERROR` and a written sentence.
 *
 * ── Submit returns a reference, never a result ───────────────────────────────
 *
 * No `Prefer: wait`, deliberately. Replicate offers a synchronous mode and it
 * is exactly wrong here: a video clean takes minutes, an HTTP request that
 * waits for it will hit the platform's ceiling, and the prediction we paid for
 * would finish with nobody listening. The request returns as soon as Replicate
 * has accepted the work; the outcome arrives at the webhook.
 */

const API = "https://api.replicate.com/v1";

/** How long we are willing to wait for Replicate to ACCEPT work (not to do it). */
const SUBMIT_TIMEOUT_MS = 20_000;

function token(): string {
  const value = process.env.REPLICATE_API_TOKEN?.trim();
  if (!value) throw new AiJobError("FEATURE_UNAVAILABLE", "REPLICATE_API_TOKEN is not set");
  return value;
}

/** One place that talks to Replicate, so the auth header exists once. */
async function call(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? SUBMIT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* a non-JSON body is still useful to log */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

interface ReplicatePrediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  version?: string;
  urls?: { cancel?: string };
}

/** One prediction body turned into our vocabulary. */
function toState(body: ReplicatePrediction, fallbackReference: string): AiProviderState {
  return {
    reference: typeof body.id === "string" && body.id ? body.id : fallbackReference,
    // An unrecognised status maps to null and the caller leaves the job alone —
    // see lib/ai/replicate/status.ts for why guessing here is the dangerous
    // option. `queued` is used only when there is genuinely nothing to read.
    status: mapReplicateStatus(body.status) ?? "queued",
    // Replicate answers with the version it actually ran, which is what makes
    // the pinned id worth storing: this is the record, not our intention.
    modelVersion: typeof body.version === "string" ? body.version : AI_CLEAN_CONFIG.version || null,
    resultUrl: extractOutputUrl(body.output),
    detail:
      body.error === null || body.error === undefined
        ? null
        : // Trimmed hard: this is stored for operators, and a provider can put a
          // great deal into an error field.
          String(typeof body.error === "string" ? body.error : JSON.stringify(body.error)).slice(0, 2000),
  };
}

export const replicateProvider: AiProvider = {
  id: "replicate",

  isConfigured() {
    return aiCleanMisconfiguration() === null;
  },

  async submit(input: AiProviderSubmission): Promise<AiProviderState> {
    const misconfigured = aiCleanMisconfiguration();
    if (misconfigured) throw new AiJobError("FEATURE_UNAVAILABLE", misconfigured);

    /*
      🔴 `version` is the PINNED id from configuration, and `input` is built by
      `buildAiCleanInput`. Neither can be influenced by the request that started
      this job: the route never sees a model name, and this function never takes
      one. That is the whole reason both live in lib/ai/config.ts.

      `webhook_events_filter` asks only for the two transitions worth a round
      trip. Subscribing to `logs` or `output` would mean a webhook call for
      every progress line the model prints — dozens of invocations per job, all
      doing nothing.
    */
    const res = await call("/predictions", {
      method: "POST",
      body: JSON.stringify({
        version: AI_CLEAN_CONFIG.version,
        input: buildAiCleanInput(input.sourceUrl),
        webhook: input.webhookUrl,
        webhook_events_filter: ["start", "completed"],
      }),
    });

    if (!res.ok) {
      /*
        🔴 402 and 429 are OUR account, not this job.

        Observed in production on 2026-09-08: an out-of-credit Replicate account
        answers 402 on every submission, and a member was told "try again in a
        moment" — advice that could never work, on a failure they did not cause.
        429 is the same shape: Replicate throttles uncredited accounts hard.

        Both map to PROVIDER_UNAVAILABLE so the interface stops promising a
        retry that cannot succeed. The usage release is unaffected — nobody is
        charged for either (see the start route's catch).
      */
      const ourProblem = res.status === 402 || res.status === 429;
      console.error("[ai/replicate] submit rejected", {
        jobId: input.jobId,
        status: res.status,
        classified: ourProblem ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        body: res.text.slice(0, 500),
      });
      throw new AiJobError(
        ourProblem ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
        `replicate ${res.status}: ${res.text.slice(0, 500)}`,
      );
    }

    const body = (res.json ?? {}) as ReplicatePrediction;
    if (!body.id) {
      throw new AiJobError("PROVIDER_ERROR", "replicate accepted the job but returned no prediction id");
    }
    return toState(body, body.id);
  },

  async poll(reference: string): Promise<AiProviderState> {
    const res = await call(`/predictions/${encodeURIComponent(reference)}`, { method: "GET" });
    if (!res.ok) {
      throw new AiJobError("PROVIDER_ERROR", `replicate poll ${res.status}: ${res.text.slice(0, 300)}`);
    }
    return toState((res.json ?? {}) as ReplicatePrediction, reference);
  },

  async cancel(reference: string): Promise<boolean> {
    try {
      const res = await call(`/predictions/${encodeURIComponent(reference)}/cancel`, { method: "POST" });
      // A prediction that already finished cannot be cancelled, and that is not
      // an error worth surfacing — the caller marks the job cancelled either
      // way, because the member's intent is what the status records.
      return res.ok;
    } catch {
      return false;
    }
  },

  async parseWebhook(): Promise<AiProviderState | null> {
    /*
      🔴 Deliberately not implemented here.

      The seam declares this method so a provider owns its own verification, and
      Replicate's belongs to the route: the signature covers the RAW request
      body, so it has to be checked before anything parses or re-serialises it —
      see app/api/ai/replicate/webhook/route.ts and lib/ai/replicate/signature.ts.
      Returning null rather than an unverified state means a future caller that
      reached for this by mistake gets nothing, instead of a trusted-looking
      object nobody checked.
    */
    return null;
  },
};

/** The prediction body a verified webhook carried, in our vocabulary. */
export function stateFromWebhookBody(body: unknown): AiProviderState | null {
  if (!body || typeof body !== "object") return null;
  const prediction = body as ReplicatePrediction;
  if (typeof prediction.id !== "string" || !prediction.id) return null;
  return toState(prediction, prediction.id);
}
