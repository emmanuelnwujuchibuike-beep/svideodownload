import { AI_CLEAN_FORMATS, AI_CLEAN_MAX_BYTES } from "@/lib/ai/clean-media";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the job vocabulary, and the registry that decides what may run
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 2): the backend foundation, built so a second and a
 * fifth AI tool need no new tables, no new routes and no new policies.
 *
 * ── One shape, many features ─────────────────────────────────────────────────
 *
 * `feature` is a value, never a code path. AI Clean is the first tool; upscale,
 * caption and background-remove are the same lifecycle with a different worker
 * on the end. Everything specific to a tool — who runs it, what it accepts, how
 * much of a day it costs — is one row in FEATURES, and the route reads that row
 * rather than branching on the tool's name.
 *
 * ── The registry is the ONLY place a provider or model is decided ────────────
 *
 * 🔴 Not the browser. A request that could name its own provider or model could
 * point the owner's credentials at an arbitrary model and bill them for it, and
 * a request that could name its own cost could set it to zero. The client sends
 * a feature and a description of its input; every other field on the row comes
 * from here or from the database's defaults.
 *
 * Pure module: no DB, no env reads at import time, no React. Availability is
 * computed from capabilities PASSED IN, the same discipline `lib/ai/tools.ts`
 * uses, so this file stays testable and the server stays the one thing that
 * knows what is configured.
 */

/** Every feature the job system can ever store. Mirrors `ai_jobs_feature_chk`. */
export type AiFeature =
  | "ai_clean"
  | "ai_image_clean"
  | "ai_upscale"
  | "ai_caption"
  | "ai_background_remove"
  | "ai_generate";

/** Mirrors `ai_jobs_status_chk`. The database is the authority; this is the mirror. */
export type AiJobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired";

/** Mirrors `ai_jobs_provider_chk`. */
export type AiProviderId = "replicate";

export const AI_JOB_STATUSES: readonly AiJobStatus[] = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

/** A job that is still going to change. Everything else is terminal. */
export const AI_ACTIVE_STATUSES: readonly AiJobStatus[] = ["queued", "processing"] as const;

export function isActiveStatus(status: AiJobStatus): boolean {
  return AI_ACTIVE_STATUSES.includes(status);
}

/**
 * Which status a job may move to next.
 *
 * A terminal job is terminal: nothing re-opens a `completed` row, nothing
 * "fails" a `cancelled` one. Written down here rather than left to whichever
 * webhook arrives last, because a provider retrying a callback out of order is
 * normal and must not be able to walk a finished job backwards.
 */
const TRANSITIONS: Record<AiJobStatus, readonly AiJobStatus[]> = {
  queued: ["processing", "failed", "cancelled", "expired"],
  processing: ["completed", "failed", "cancelled", "expired"],
  completed: ["expired"],
  failed: ["expired"],
  cancelled: ["expired"],
  expired: [],
};

export function canTransition(from: AiJobStatus, to: AiJobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** What the client may say about its input. Everything here is a CLAIM. */
export interface AiJobSourceInput {
  /** Bytes, as reported by the browser's File object. */
  size: number;
  mimeType: string;
  /** Seconds. Optional — a container the browser cannot measure has none. */
  durationSeconds?: number;
  /** The original filename, kept only so history is readable. */
  name?: string;
}

export interface AiFeatureDef {
  id: AiFeature;
  label: string;
  /** Who will run it. Recorded on the job at creation; never client-supplied. */
  provider: AiProviderId;
  /**
   * The provider capability this feature needs. A feature whose capability is
   * not configured is refused up front rather than queued into a void.
   */
  requires: "replicate";
  /** Successful-or-outstanding jobs a FREE member may have per UTC day. */
  freeDailyJobs: number;
  /** Accepted MIME types. Empty means "any of this kind" — never used yet. */
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Longest input, in seconds. Provider time is billed by the second. */
  maxDurationSeconds: number;
  /**
   * How long the job's files may live. Read by a later part's cleanup worker
   * via `expires_at`; nothing deletes anything today.
   *
   * 72 hours: long enough that a video cleaned on a Friday can still be
   * collected on a Sunday, short enough that somebody's unpublished footage is
   * not sitting in our storage indefinitely. It is a retention promise, so it
   * lives beside the feature it applies to rather than in a constants file.
   */
  retentionHours: number;
}

export const AI_FEATURES: readonly AiFeatureDef[] = [
  {
    id: "ai_clean",
    label: "AI Clean",
    provider: "replicate",
    requires: "replicate",
    // Owner's rule: 3 successful AI Clean jobs per calendar day for free members.
    freeDailyJobs: 3,
    mimeTypes: AI_CLEAN_FORMATS.flatMap((f) => f.mimeTypes),
    // The same ceiling the picker already enforces (lib/ai/clean-media.ts), so a
    // file the interface accepted can never be refused by the server for a
    // reason the interface did not know about.
    maxBytes: AI_CLEAN_MAX_BYTES,
    // Ten minutes. Text removal is per-frame work: a long clip is not a bigger
    // request, it is a hundred of them, and the bill scales with it.
    maxDurationSeconds: 600,
    retentionHours: 72,
  },
] as const;

const FEATURES_BY_ID = new Map(AI_FEATURES.map((f) => [f.id, f]));

export function aiFeature(id: string): AiFeatureDef | null {
  return FEATURES_BY_ID.get(id as AiFeature) ?? null;
}

/**
 * What this deployment can actually run.
 *
 * Passed in rather than read from `process.env` here, so this module stays pure
 * and the server remains the one thing that knows what is configured — exactly
 * how `lib/ai/tools.ts` handles the same question.
 */
export interface AiCapabilities {
  /** A Replicate token is configured. False for the whole of Part 2. */
  replicate: boolean;
  /**
   * 🔴 DEVELOPMENT ONLY. Permits a job to be created for a feature whose
   * provider is not configured, so the plumbing — idempotency, ownership,
   * the daily cap — can be exercised end to end before Part 3 exists.
   *
   * The job is created `queued` and NOTHING advances it. It never reports
   * success, because nothing ever succeeds. Off unless a deployment sets
   * FRENZ_AI_ALLOW_UNDISPATCHED_JOBS, which production does not.
   */
  allowUndispatched: boolean;
}

export type AiFeatureAvailability =
  | { available: true; dispatchable: boolean }
  | { available: false; reason: string };

/**
 * Whether a feature may accept a job right now.
 *
 * `dispatchable` is the honest second half: a feature can be open for business
 * (the dev flag above) while nothing exists to run its jobs. Callers surface
 * that to the client rather than letting someone wait on a queue with no worker.
 */
export function featureAvailability(
  feature: AiFeatureDef,
  caps: AiCapabilities,
): AiFeatureAvailability {
  if (feature.requires === "replicate" && !caps.replicate) {
    if (caps.allowUndispatched) return { available: true, dispatchable: false };
    return {
      available: false,
      // Said plainly. The member is not at fault and the owner may be reading it.
      reason: "The AI service isn't connected yet.",
    };
  }
  return { available: true, dispatchable: true };
}

/** Why a validated input was refused, in the error vocabulary. */
export type AiInputVerdict =
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "FILE_TOO_LARGE" | "UNSUPPORTED_FORMAT" };

/**
 * The server's own check on what the client says it has.
 *
 * 🔴 This repeats the browser's check on purpose. The picker's validation
 * (lib/ai/clean-media.ts) is there to give someone a fast, kind answer; it is
 * not a control, because the thing enforcing it is running on their machine.
 * The numbers come from the same registry so the two can never disagree about
 * what is allowed — only about who is trusted to say so.
 */
export function validateJobInput(feature: AiFeatureDef, source: AiJobSourceInput): AiInputVerdict {
  if (!Number.isFinite(source.size) || source.size <= 0) return { ok: false, code: "INVALID_INPUT" };
  if (source.size > feature.maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };

  const mime = source.mimeType.trim().toLowerCase();
  if (feature.mimeTypes.length > 0 && !feature.mimeTypes.includes(mime)) {
    return { ok: false, code: "UNSUPPORTED_FORMAT" };
  }

  if (source.durationSeconds !== undefined) {
    if (!Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) {
      return { ok: false, code: "INVALID_INPUT" };
    }
    if (source.durationSeconds > feature.maxDurationSeconds) return { ok: false, code: "INVALID_INPUT" };
  }

  return { ok: true };
}

/**
 * An idempotency key the server is willing to trust as a key.
 *
 * It only has to be unique per member and stable across that member's retries,
 * so the rule is about SHAPE, not about secrecy: bounded length and a plain
 * alphabet, because the value reaches a unique index and an error message. The
 * length floor matches the database's own CHECK, so a value that passes here
 * can never be rejected by the insert.
 */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/;

export function isValidClientRequestId(value: string): boolean {
  return CLIENT_REQUEST_ID.test(value);
}

/** The row as it exists in Postgres. Service-role reads only. */
export interface AiJobRow {
  id: string;
  user_id: string;
  feature: AiFeature;
  provider: AiProviderId;
  model: string | null;
  model_version: string | null;
  status: AiJobStatus;
  client_request_id: string | null;
  source_path: string | null;
  result_path: string | null;
  source_size: number | null;
  result_size: number | null;
  source_duration: number | string | null;
  source_mime_type: string | null;
  replicate_prediction_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
}

/** What a browser is allowed to know about its own job. */
export interface AiJobView {
  id: string;
  feature: AiFeature;
  status: AiJobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  /** Milliseconds from start to finish, or null while it has not finished. */
  durationMs: number | null;
  source: {
    size: number | null;
    mimeType: string | null;
    durationSeconds: number | null;
    name: string | null;
  };
  /** A stable code and a written sentence. Never the provider's own words. */
  error: { code: string; message: string } | null;
}

/**
 * The row, reduced to what may leave the server.
 *
 * 🔴 An allow-list, not a delete-list. Written this way because the dangerous
 * version of this function is the one that spreads the row and deletes three
 * fields: the next column added — a provider id, an internal path, a cost —
 * ships to every client by default, and nobody notices. Here a new column is
 * invisible until somebody adds a line.
 *
 * Deliberately absent: `provider`, `model`, `model_version`,
 * `replicate_prediction_id`, `source_path`, `result_path`, `error_message`,
 * `metadata`. None of them are the member's business, and several are the
 * makings of an attack on the provider account.
 */
export function jobToView(row: AiJobRow, errorMessageFor: (code: string) => string): AiJobView {
  const started = row.started_at ? Date.parse(row.started_at) : null;
  const completed = row.completed_at ? Date.parse(row.completed_at) : null;
  const duration =
    started !== null && completed !== null && Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : null;

  const rawDuration = row.source_duration;
  const sourceDuration =
    rawDuration === null || rawDuration === undefined ? null : Number(rawDuration);

  return {
    id: row.id,
    feature: row.feature,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    durationMs: duration,
    source: {
      size: row.source_size,
      mimeType: row.source_mime_type,
      durationSeconds: Number.isFinite(sourceDuration as number) ? (sourceDuration as number) : null,
      name: typeof row.metadata?.source_name === "string" ? row.metadata.source_name : null,
    },
    error: row.error_code ? { code: row.error_code, message: errorMessageFor(row.error_code) } : null,
  };
}

/* ───────────────── keyset pagination cursors (pure, so they are testable) ── */

/**
 * Opaque only in the sense that it is not a promise: it is base64url of a
 * timestamp and an id, both of which the holder already has. It is not a
 * capability — every query it feeds is still scoped to the caller's own rows by
 * RLS, so a forged cursor can only ever page through the forger's own history.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    // Both halves are interpolated into a PostgREST filter, so both are checked
    // against a strict shape first. A cursor is client-supplied text.
    if (!/^[0-9T:.+\-Z ]{10,40}$/.test(createdAt)) return null;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
