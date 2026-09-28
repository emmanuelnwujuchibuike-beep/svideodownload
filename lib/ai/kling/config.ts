/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING — the endpoints, the vocabulary, the limits (PURE, VERIFIED)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-28 (Part 4): Kling becomes the ONLY video provider, and
 * "verify the live API contract before routing production traffic. Do not rely
 * blindly on mirrors or assumptions from previous code."
 *
 * ── 🔴 EVERYTHING HERE WAS READ OFF THE LIVE API ────────────────────────────
 *
 * Part 2 wrote this file from mirrors, marked the guesses ⚠️, and asked for
 * them to be confirmed. They were, on 2026-09-28, with a real key — and most
 * of them were WRONG. The full evidence is in
 * `docs/AI_PROVIDER_MIGRATION_PART4_KLING_CONTRACT.md`; the corrections that
 * matter to a reader of this file are:
 *
 *   · the request body is `{ contents[], settings{}, options{} }` — there is no
 *     `model_name`, `prompt`, `image_list`, `element_list`, `video_list`,
 *     `mode` or `sound` anywhere in it;
 *   · `callback_url` lives in `options`. At the top level it is SILENTLY
 *     IGNORED, so Part 2's placement would have produced jobs that generate,
 *     bill, and never call back;
 *   · the result is `outputs[]`, not `task_result.videos[]`;
 *   · the cost is reported in UNITS on the task (`billing[]`);
 *   · `POST /v1/videos/omni` does not exist (404), so neither does the
 *     "legacy Omni surface" Part 2 branched on;
 *   · Lip Sync is a real, separate endpoint — `POST /v1/videos/lip-sync`.
 *
 * Pure like `lib/ai/providers/config.ts`: no imports, no `process.env` at
 * module scope, no React. The client reads the credentials; this file only
 * says where to send them and what the answers mean.
 *
 * ── 🔴 DIRECT ONLY (§1, §31.1) ──────────────────────────────────────────────
 *
 * These are Kling's OWN hosts. Nothing here may ever point at Replicate,
 * fal.ai, Kie, Pollo, PiAPI or any other reseller: an aggregator is a second
 * vendor wearing Kling's name, with its own pricing, its own request shape and
 * its own outage. Those wrappers are also why this file was wrong before —
 * Pollo's published "Kling schema" is `{input:{prompt, refs[], webhookUrl}}`,
 * which the direct API rejects outright.
 */

/** Kling's own API host. Verified 2026-09-28: this one serves the Omni surface. */
export const KLING_DEFAULT_BASE_URL = "https://api-singapore.klingai.com";

/**
 * The hosts a Kling base URL may have.
 *
 * 🔴 `api.klingai.com` was REMOVED on 2026-09-28. It is genuinely Kling's own
 * domain, but it does not serve this surface: `GET /tasks` there answers a
 * `404` **HTML** page (it carries only the legacy `/v1/**` tree). Leaving it in
 * the allow-list meant one `KLING_API_BASE_URL` edit could break every status
 * read while looking like a supported configuration — and deliver HTML where
 * JSON was expected, which is the shape of a recorded outage on this project.
 *
 * `api-beijing` is Kling's mainland host. It is kept because it is the vendor's
 * own and the guard exists to exclude *aggregators*, not regions — but it has
 * NOT been verified against the Omni surface. A host is only safe to rely on
 * once someone has run `klingCredentialCheck()` against it.
 */
export const KLING_ALLOWED_API_HOSTS: readonly string[] = ["api-singapore.klingai.com", "api-beijing.klingai.com"];

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
 *   api_key   `Authorization: Bearer <KLING_API_KEY>`. ✅ VERIFIED 2026-09-28
 *             against `/omni-video/kling-v3-omni`, `GET /tasks` and
 *             `/v1/videos/lip-sync` — one credential serves all three.
 *   jwt       an HS256 token minted from KLING_ACCESS_KEY / KLING_SECRET_KEY.
 *             ⚠️ NOT verified. Kept only so an account that was issued an
 *             AK/SK pair instead of an API key has a door; a deployment on it
 *             must run the credential check before trusting it.
 *
 * 🔴 Part 2 also branched the REQUEST BODY on this. That is gone: the two
 * "surfaces" it described do not exist, so the body is the same either way.
 */
export type KlingAuthMode = "api_key" | "jwt";

/** The vendor's documented token lifetime. Minted per request; never cached to disk. */
export const KLING_JWT_TTL_SECONDS = 30 * 60;
/** `nbf` is set slightly in the past so a few seconds of clock skew cannot reject a fresh token. */
export const KLING_JWT_NOT_BEFORE_SKEW_SECONDS = 5;

/* ────────────────────────────── endpoints ────────────────────────────────── */

/**
 * The Omni create surface: `POST /omni-video/<model>`. ✅ VERIFIED — the model
 * is a PATH SEGMENT, which is why the id is validated before interpolation.
 */
export const KLING_OMNI_VIDEO_PATH = "/omni-video";

/**
 * The unified task query: `GET /tasks?task_ids=a,b,c`. ✅ VERIFIED, including
 * that it answers `200` with `data: []` for a task it does not know, and that
 * `?external_task_ids=…` is an equally valid lookup key.
 */
export const KLING_TASKS_PATH = "/tasks";

/**
 * 🔴 KLING LIP SYNC — its own endpoint, its own model, its own request shape.
 * ✅ VERIFIED 2026-09-28.
 *
 * Part 3 declared Lip Sync unavailable because "lip sync is not a documented
 * mode of Omni". True, and beside the point: the owner's §6 said precisely
 * that Omni not having a mode is not evidence Kling lacks the capability, and
 * it does not — this path validates `input.mode`, `video_url`, `audio_type`,
 * `text`, `voice_id`, `voice_language` and `voice_speed`.
 */
export const KLING_LIP_SYNC_PATH = "/v1/videos/lip-sync";

/** The legacy per-product task query, for tasks created on the `/v1/**` tree (lip sync). */
export const KLING_LEGACY_TASK_PATH = "/v1/videos";

/** Kling 3.0 Omni. ✅ VERIFIED accepted; `kling-v3-1-omni` answers "model is not supported". */
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
 * The vendor's task statuses. ✅ All four observed live.
 *
 * `succeed` is kept alongside `succeeded` because the legacy `/v1` tree uses
 * the shorter spelling, and a job that finished must never be read as
 * "unknown, leave it alone".
 */
export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "succeeded" | "failed";

/** The envelope every Kling answer carries. ✅ VERIFIED on create, query and error. */
export interface KlingEnvelope<T = unknown> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

/**
 * One finished output. ✅ VERIFIED shape:
 * `{ "type": "video", "id": "…", "url": "https://…", "duration": "5.041" }`
 */
export interface KlingOutput {
  type?: string;
  id?: string;
  url?: string;
  duration?: string | number;
  [key: string]: unknown;
}

/**
 * What the vendor charged. ✅ VERIFIED:
 * `[{ "charge_type": "unit", "amount": "3", "package_type": "video" }]`
 * and `[{ "amount": "0" }]` on a task that failed before generating.
 *
 * 🔴 This is the real provider consumption figure, reported per task. It is the
 * reason the pricing model is a UNIT matrix rather than a per-second rate.
 */
export interface KlingBillingLine {
  charge_type?: string;
  amount?: string | number;
  package_type?: string;
  [key: string]: unknown;
}

/** One task, as the create call, the query call and the callback all describe it. */
export interface KlingTaskData {
  /** ✅ The new surface answers `id`; the legacy `/v1` tree answers `task_id`. Both are read. */
  id?: string;
  task_id?: string;
  /** ✅ `status` on the new surface, `task_status` on the legacy one. */
  status?: string;
  task_status?: string;
  /** ✅ The failure reason is `message`. (Part 2's `task_status_msg` does not exist here.) */
  message?: string;
  task_status_msg?: string;
  /** ✅ The finished result. NOT `task_result.videos[]`. */
  outputs?: readonly KlingOutput[] | null;
  /** ✅ What it cost, in units. */
  billing?: readonly KlingBillingLine[] | null;
  /** The caller's own handle, echoed back when one was sent. */
  external_task_id?: string;
  task_info?: { external_task_id?: string } | null;
  create_time?: number | string;
  update_time?: number | string;
  /** The legacy `/v1` tree's result envelope, kept so a lip-sync task parses too. */
  task_result?: KlingTaskResult | null;
  [key: string]: unknown;
}

/** The legacy `/v1` result envelope. Retained for the lip-sync surface. */
export interface KlingTaskResult {
  videos?: readonly { id?: string; url?: string; duration?: string | number }[];
  images?: readonly { index?: number; url?: string }[];
  [key: string]: unknown;
}

/** `code: 0` is success on every verified Kling endpoint. */
export const KLING_OK_CODE = 0;

/**
 * Vendor error codes worth naming. Everything else is classified by HTTP
 * status. These are the ones whose MEANING changes what we do.
 */
export const KLING_ERROR_CODES = {
  /** ✅ VERIFIED: every request-validation fault answers `400` with `code: 1201`. */
  INVALID_REQUEST: 1201,
  /** ⚠️ Reported by a maintained client for AK/SK on this surface. Not reproduced. */
  AK_SK_NOT_SUPPORTED: 1002,
  /** ⚠️ Account concurrency reached — ours, not the member's. Not reproduced. */
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
