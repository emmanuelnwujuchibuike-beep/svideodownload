/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING 3.0 OMNI — the endpoints, the vocabulary, the limits (PURE)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-28 (Part 2): build the direct Kling provider seam alongside
 * Replicate and fal.ai, route no feature to it yet.
 *
 * Pure like `lib/ai/providers/config.ts`: no imports, no `process.env` at
 * module scope, no React. The client reads the credentials, this file only
 * says where to send them and what the answers mean — so every mapping here
 * is testable without a key.
 *
 * ── 🔴 DIRECT ONLY (§5) ─────────────────────────────────────────────────────
 *
 * These are Kling's OWN hosts. Nothing here may ever point at Replicate,
 * fal.ai, Kie, Pollo, PiAPI or any other reseller: an aggregator is a second
 * vendor wearing Kling's name, with its own pricing, its own request shape
 * and its own outage. `assertDirectKlingHost` is the guard, and it is called
 * by the client on every request.
 *
 * ── ⚠️ WHAT IS VERIFIED AND WHAT IS NOT (§6) ────────────────────────────────
 *
 * Kling's official reference (kling.ai/document-api) is a client-rendered
 * single-page app: it returns a bare title to any non-browser fetch, so it
 * could not be read directly on 2026-09-28. What is below was assembled from
 * several independent sources that agree with each other, and each item is
 * marked with how sure it is. Part 3 must confirm the ⚠️ ones against a live
 * key before a member's money depends on them.
 *
 *   ✅ the response envelope `{ code, message, request_id, data }` and the
 *      task shape `data.task_id` / `data.task_status` / `data.task_status_msg`
 *      / `data.task_result.videos[].url` — quoted identically by every source
 *   ✅ `callback_url` on create; the callback body is that same envelope
 *   ✅ task statuses `submitted` · `processing` · `succeed` · `failed`
 *   ✅ the 30-minute HS256 JWT (iss = access key, exp = +30 min, nbf = −5 s)
 *      for the LEGACY `/v1/...` surface
 *   ⚠️ the NEW-STANDARD surface used by the 3.x models — `POST /omni-video/
 *      <model>` with a plain API-key bearer, and a unified `GET /tasks`.
 *      One maintained client reports that the new endpoints REFUSE AK/SK
 *      outright ("1002 The current API does not support AK/SK"), which is why
 *      both auth modes exist here rather than one.
 *   ⚠️ `kling-v3-omni` as the model id, and `external_task_id` as the
 *      caller's own idempotency handle on the Omni endpoint.
 *
 * Nothing undocumented is invented: a field nobody published is not sent.
 */

/** Kling's own API host. Singapore is the global endpoint; `KLING_API_BASE_URL` overrides it. */
export const KLING_DEFAULT_BASE_URL = "https://api-singapore.klingai.com";

/**
 * The hosts a Kling base URL may have. An aggregator's domain is refused at
 * the client, not discovered in production (§5).
 */
export const KLING_ALLOWED_API_HOSTS: readonly string[] = ["api-singapore.klingai.com", "api.klingai.com", "api-beijing.klingai.com"];

/** Where a Kling output may be fetched FROM — defence in depth, like `isFalOutputHost`. */
export function isKlingOutputHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return host === "klingai.com" || host.endsWith(".klingai.com") || host === "kling.ai" || host.endsWith(".kling.ai") || host.endsWith(".kuaishou.com") || host.endsWith(".kwaicdn.com");
}

/** True when `base` is one of Kling's own hosts over https. */
export function isDirectKlingBaseUrl(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return KLING_ALLOWED_API_HOSTS.includes(url.hostname.toLowerCase());
}

/* ─────────────────────────────── auth ────────────────────────────────────── */

/**
 * How this deployment authenticates.
 *
 *   api_key   `Authorization: Bearer <KLING_API_KEY>` — the new-standard
 *             surface the 3.x models live on.
 *   jwt       `Authorization: Bearer <HS256 JWT>` minted from
 *             KLING_ACCESS_KEY / KLING_SECRET_KEY — the legacy `/v1` surface.
 *
 * Both exist because the two surfaces genuinely differ (see the ⚠️ note
 * above) and because guessing wrong is a 401 in production on the day a
 * member first presses Create.
 */
export type KlingAuthMode = "api_key" | "jwt";

/** The vendor's documented token lifetime. Minted per request; never cached to disk. */
export const KLING_JWT_TTL_SECONDS = 30 * 60;
/** `nbf` is set slightly in the past so a few seconds of clock skew cannot reject a fresh token. */
export const KLING_JWT_NOT_BEFORE_SKEW_SECONDS = 5;

/* ────────────────────────────── endpoints ────────────────────────────────── */

/**
 * The Omni surface. The model is a PATH SEGMENT on the new standard
 * (`POST /omni-video/kling-v3-omni`), not a body field — which is why the
 * model id is validated before it is interpolated.
 */
export const KLING_OMNI_VIDEO_PATH = "/omni-video";
/** The unified task query on the new standard: `GET /tasks?task_ids=a,b,c`. */
export const KLING_TASKS_PATH = "/tasks";
/** The legacy per-product query, used only when this deployment is on JWT/AK-SK. */
export const KLING_LEGACY_TASK_PATH = "/v1/videos";
/**
 * The legacy Omni create path, where the model travels in the BODY
 * (`model_name`) rather than in the path. Part 3 (2026-09-28): the two
 * surfaces express the model differently, so the client picks the path and
 * the body shape together from `klingAuthMode()` — a handler always emits
 * `model_name` and the client removes it on the surface that does not want it.
 */
export const KLING_LEGACY_OMNI_PATH = "/v1/videos/omni";

/** Kling 3.0 Omni. One model, many input shapes — Part 3 decides which per feature. */
export const KLING_OMNI_MODEL = "kling-v3-omni";

/** The models this seam will address. A model not listed here cannot be interpolated into a path. */
export const KLING_MODELS: readonly string[] = [KLING_OMNI_MODEL];

/** A model id safe to place in a URL path: the vendor's own charset, nothing that could traverse or carry a query. */
export function isValidKlingModelId(model: string): boolean {
  return /^[a-z0-9][a-z0-9.\-]{0,63}$/i.test(model);
}

/** `POST /omni-video/<model>` — the create path for one model. Throws on a model that is not a plain id. */
export function klingOmniVideoPath(model: string): string {
  if (!isValidKlingModelId(model)) throw new Error("kling: refusing a model id that is not a plain identifier");
  return `${KLING_OMNI_VIDEO_PATH}/${model}`;
}

/* ─────────────────────────────── the task ────────────────────────────────── */

/**
 * The vendor's task statuses.
 *
 * `succeed` is the legacy spelling and `succeeded` the new-standard one;
 * both are accepted because a deployment can meet either and a job that
 * finished must never be read as "unknown, leave it alone".
 */
export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "succeeded" | "failed";

/** The envelope every Kling answer carries. `data` is the only part that differs per endpoint. */
export interface KlingEnvelope<T = unknown> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

/** One task, as the create call, the query call and the callback all describe it. */
export interface KlingTaskData {
  task_id?: string;
  /** The new standard answers `id` on some surfaces; both are read. */
  id?: string;
  task_status?: string;
  status?: string;
  task_status_msg?: string;
  /** The caller's own handle, echoed back when one was sent (§14). */
  external_task_id?: string;
  task_info?: { external_task_id?: string } | null;
  created_at?: number | string;
  updated_at?: number | string;
  task_result?: KlingTaskResult | null;
  [key: string]: unknown;
}

export interface KlingTaskResult {
  videos?: readonly { id?: string; url?: string; duration?: string | number }[];
  images?: readonly { index?: number; url?: string }[];
  [key: string]: unknown;
}

/** `code: 0` is success on every documented Kling endpoint. */
export const KLING_OK_CODE = 0;

/**
 * Vendor error codes worth naming. Everything else is classified by HTTP
 * status. These are the ones whose MEANING changes what we do rather than
 * only what we log.
 */
export const KLING_ERROR_CODES = {
  /** The new-standard endpoints reject AccessKey/SecretKey credentials outright. */
  AK_SK_NOT_SUPPORTED: 1002,
  /** Account concurrency reached — ours, not the member's; answered immediately. */
  CONCURRENCY_LIMIT: 1303,
} as const;

/* ───────────────────────────── the callback ──────────────────────────────── */

/**
 * How long a signed callback stays acceptable. The same replay window the
 * fal.ai verifier uses, for the same reason: a captured delivery re-sent an
 * hour later is refused even though it is genuinely signed.
 */
export const KLING_CALLBACK_TOLERANCE_SECONDS = 5 * 60;

/** The vendor asks for a 2xx within five seconds; the route must never do work inline. */
export const KLING_CALLBACK_BUDGET_MS = 5_000;
