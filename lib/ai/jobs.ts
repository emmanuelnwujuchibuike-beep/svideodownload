import { z } from "zod";

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
export type AiJobStatus =
  | "queued"
  /**
   * OUR worker is fetching the member's video from a link they pasted (Part 6).
   * The provider has not been asked for anything, so nothing is billable yet.
   *
   * 🔴 Not folded into `processing`. A job in `processing` has been submitted
   * to a provider and costs money; a job in `acquiring` has not. Sharing one
   * value between those two would also make the progress screen say "Removing
   * text" during a download, which is a sentence about work that is not
   * happening.
   */
  | "acquiring"
  | "processing"
  /**
   * The provider is done and OUR worker is running: the cleaned video is being
   * muxed back together with the original audio (Part 4). A real, distinct
   * state — without it the interface would leave somebody on "removing text"
   * for a minute after the AI had already finished.
   */
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

/** Mirrors `ai_jobs_provider_chk`. */
export type AiProviderId = "replicate";

export const AI_JOB_STATUSES: readonly AiJobStatus[] = [
  "queued",
  "acquiring",
  "processing",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

/** A job that is still going to change. Everything else is terminal. */
export const AI_ACTIVE_STATUSES: readonly AiJobStatus[] = [
  "queued",
  "acquiring",
  "processing",
  "finalizing",
] as const;

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
  /*
    Two ways out, and which one depends on where the video is coming from.
    An UPLOAD goes straight to `processing` — the file is already in storage by
    the time /start runs. A LINK goes to `acquiring` first, because the bytes do
    not exist yet and our worker has to go and get them.
  */
  queued: ["acquiring", "processing", "failed", "cancelled", "expired"],
  /*
    🔴 `acquiring` may NOT reach `finalizing` or `completed`. The only forward
    move is `processing`, which is the moment the provider is actually asked to
    do something — so there is no path where a job we merely downloaded can be
    handed back as a cleaned video.
  */
  acquiring: ["processing", "failed", "cancelled", "expired"],
  /*
    🔴 processing may NOT go straight to completed any more. The provider
    finishing is not the job finishing — the video has no audio on it yet. The
    only way to completed is through finalizing, which is what makes it
    impossible for a future webhook change to hand somebody a silent video and
    call it done.
  */
  processing: ["finalizing", "failed", "cancelled", "expired"],
  finalizing: ["completed", "failed", "cancelled", "expired"],
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
  /**
   * How the bytes will arrive. Absent means `upload` — every client written
   * before Part 6 sends no `kind` at all, and refusing those would have been a
   * breaking change to a shipped endpoint for no gain.
   */
  kind?: AiSourceKind;
  /** Bytes, as reported by the browser's File object. Absent for a link. */
  size?: number;
  /** Absent for a link: nobody knows what a page will yield until it is fetched. */
  mimeType?: string;
  /** Seconds. Optional — a container the browser cannot measure has none. */
  durationSeconds?: number;
  /** The original filename, kept only so history is readable. */
  name?: string;
  /**
   * The page to fetch, for a `url` source.
   *
   * 🔴 A CLAIM, exactly like every other field here. It is worth nothing until
   * `validateAiSourceUrl` has accepted it, and what is stored is that
   * function's normalised output rather than this string.
   */
  url?: string;
}

/** Mirrors `ai_jobs_source_kind_chk` (migration 0146). */
export type AiSourceKind = "upload" | "url";

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
  /**
   * Whether a finished provider output still needs OUR worker before it is
   * deliverable. True for AI Clean: the model returns video with no audio, so
   * a job whose mux cannot run is a job that would hand somebody a silent
   * video — and it is far better to refuse it before spending anything than to
   * discover that after the provider has been paid.
   */
  needsFinalizer: boolean;
  /** Successful-or-outstanding jobs a FREE member may have per UTC day. */
  freeDailyJobs: number;
  /** Accepted MIME types. Empty means "any of this kind" — never used yet. */
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Longest input, in seconds. Provider time is billed by the second. */
  maxDurationSeconds: number;
  /**
   * How long the job's files may live, enforced by the retention sweep
   * (lib/ai/retention.ts, hourly via .github/workflows/cron-ai-retention.yml).
   *
   * ⚠️ It said "nothing deletes anything today" from Part 2 until Part 7, and
   * that was true the whole time — the promise on the result screen was kept by
   * no code at all.
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
    needsFinalizer: true,
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
  /** A Replicate token is configured. */
  replicate: boolean;
  /**
   * A worker that can run ffmpeg is reachable (lib/worker.ts).
   *
   * 🔴 Checked at CREATION, not at the end. Without it the pipeline would run
   * the whole expensive middle — upload, provider, the member waiting — and
   * fail at the last step with the bill already paid. Refusing up front costs
   * nobody anything.
   */
  finalizer: boolean;
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
  if (feature.needsFinalizer && !caps.finalizer) {
    if (caps.allowUndispatched) return { available: true, dispatchable: false };
    return {
      available: false,
      // Same sentence: which half of our own infrastructure is missing is not
      // the member's problem, and naming it publicly buys nothing.
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
  /*
    ── 🔴 A LINK HAS NOTHING TO VALIDATE HERE, AND SAYING SO IS THE POINT ─────

    The size, type and duration checks below are all about a file the browser
    is holding. For a `url` source none of those facts exist yet — the page has
    not been fetched — and inventing a number to satisfy this function would
    put a fabricated size on the row.

    They are not skipped, they MOVE: the worker applies the identical ceilings
    to the file it actually produced (`server/services/ai-acquire-service.ts`),
    which is the only moment they can be true rather than claimed. That is the
    same discipline `/start` already follows for uploads, where what storage
    reports replaces what the browser said.

    The URL's own admissibility is `validateAiSourceUrl`'s job, and the create
    route runs it before this. It is not repeated here because this module is
    pure vocabulary and that one owns the allow-list.
  */
  if (source.kind === "url") {
    if (!source.url || !source.url.trim()) return { ok: false, code: "INVALID_INPUT" };
    return { ok: true };
  }

  if (source.size === undefined || !Number.isFinite(source.size) || source.size <= 0) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (source.size > feature.maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };

  const mime = (source.mimeType ?? "").trim().toLowerCase();
  if (!mime) return { ok: false, code: "INVALID_INPUT" };
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
  /**
   * 🔴 NULL FOR A GUEST. It was typed `string` until 2026-09-08, and that lie
   * is what let `uploadFinalResult({ userId: job.user_id })` compile.
   *
   * Guest support added the `guest_id` column and `subjectFromRow`, but never
   * came back to this interface — so every service-role read of an anonymous
   * job looked to TypeScript like a member job that happened to have a null id,
   * and the compiler had no way to object. The result was a crash inside
   * `safeSegment`: "Cannot read properties of null (reading 'toLowerCase')",
   * thrown AFTER the model had run and been paid for.
   *
   * Never read this directly to identify an owner. Use `subjectFromRow(job)`
   * and `subjectOwnerId(subject)`, which handle both kinds.
   */
  user_id: string | null;
  /** The signed guest identifier. Null for a signed-in member; exactly one of the two is set. */
  guest_id: string | null;
  feature: AiFeature;
  provider: AiProviderId;
  model: string | null;
  model_version: string | null;
  status: AiJobStatus;
  client_request_id: string | null;
  source_path: string | null;
  result_path: string | null;
  /**
   * The still frame shown on a history tile (migration 0147). Null while the
   * job is unfinished, when the poster step failed — which is never fatal — and
   * on every row that predates the column.
   */
  poster_path: string | null;
  /**
   * How this job was paid for (migration 0150): `free` took a daily allowance
   * slot, `balance` deducted money. Null on rows that predate the column and on
   * jobs that never started.
   *
   * 🔴 Read by every failure path to decide which undo to run — see
   * lib/ai/funding.ts for why releasing a slot and refunding money are not
   * interchangeable, and why guessing wrong creates free videos.
   */
  funding_source: "free" | "balance" | null;
  /** What was deducted, in minor units. Null for a free job. */
  charged_cents: number | null;
  source_size: number | null;
  result_size: number | null;
  result_duration: number | string | null;
  result_mime_type: string | null;
  audio_restored: boolean | null;
  source_duration: number | string | null;
  source_mime_type: string | null;
  /**
   * How the bytes arrived (migration 0146). Nullable in the type although the
   * column is `not null default 'upload'`, because a row read by a build that
   * is newer than the migration would come back undefined — and a type that
   * lied about that is what hid the guest-id bug for a week.
   */
  source_kind: AiSourceKind | null;
  /** The allow-listed page a `url` job was created from. Null for an upload. */
  source_url: string | null;
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
    /**
     * Where it came from. The interface needs this to say true things: an
     * upload that failed can be retried from the file still in the browser's
     * hand, and a link cannot — but a link can be retried without the member
     * finding the video again, and an upload cannot.
     *
     * 🔴 The URL ITSELF is not here. See the allow-list on `jobToView`.
     */
    kind: AiSourceKind;
  };
  /**
   * The finished file, once there is one.
   *
   * `audioRestored: false` on a completed job means the SOURCE had no audio —
   * a success, not a failure — which is why it is a nullable boolean rather
   * than something the interface has to infer from a missing field.
   */
  result: {
    size: number | null;
    durationSeconds: number | null;
    audioRestored: boolean | null;
    /**
     * Whether a still frame exists for this job — NOT where it is.
     *
     * 🔴 A boolean rather than a path or a URL, and that is the same rule the
     * rest of this view follows. The poster lives in a private bucket, so the
     * only way to it is `/api/ai/jobs/<id>/poster`, which the browser can build
     * from the id it already has. Sending a path would leak the bucket layout;
     * sending a signed URL would put an expiring, per-request value into a list
     * that re-fetches itself every few seconds, and every tile's `<img>` would
     * re-download on every poll.
     *
     * What the interface actually needs to know is only "is there a picture, or
     * do I draw the plate", and that is one bit.
     */
    hasPoster: boolean;
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
 *
 * 🔴 `source_url` is absent too, and for a different reason than the rest.
 * The member typed it, so it is not a secret FROM them — but this view is the
 * shape a job takes in a browser, and a link that round-trips through the
 * client is a link a future edit could accidentally accept back. `source_kind`
 * is here because the interface genuinely needs it to offer the right retry;
 * the address is read from the row by the worker and by nothing else.
 */
export function jobToView(row: AiJobRow, errorMessageFor: (code: string) => string): AiJobView {
  const started = row.started_at ? Date.parse(row.started_at) : null;
  const completed = row.completed_at ? Date.parse(row.completed_at) : null;
  const duration =
    started !== null && completed !== null && Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : null;

  const numeric = (value: number | string | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const sourceDuration = numeric(row.source_duration);

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
      durationSeconds: sourceDuration,
      name: typeof row.metadata?.source_name === "string" ? row.metadata.source_name : null,
      // Every row that predates 0146 was an upload, and the column defaults to
      // it, so the fallback describes those rows correctly rather than guessing.
      kind: row.source_kind === "url" ? "url" : "upload",
    },
    result: {
      size: row.result_size,
      durationSeconds: numeric(row.result_duration),
      audioRestored: row.audio_restored,
      hasPoster: !!row.poster_path,
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

/**
 * The ONLY body `POST /api/ai/jobs` accepts.
 *
 * 🔴 `.strict()` on both objects, and that is a security property rather than a
 * tidiness one. A permissive schema STRIPS unknown keys, so a request carrying
 * `user_id`, `provider`, `model`, `status` or `result_path` would succeed —
 * quietly, having ignored them — and nobody reading the response could tell
 * whether those fields had done anything. Refusing the request says plainly that
 * they are not the caller's to send. The identity comes from the session, the
 * provider from the registry, the status is always `queued`, and both paths
 * belong to the server.
 *
 * Lives here rather than inside the route so it can be tested for exactly that.
 */
export const createJobRequestSchema = z
  .object({
    feature: z.string().min(1).max(40),
    clientRequestId: z.string().min(8).max(100),
    source: z
      .object({
        /*
          🔴 OPTIONAL, defaulting to `upload`. Every client shipped before Part
          6 sends a body with no `kind`, and `.strict()` would REFUSE a field it
          did not know — so making this required would break the upload flow on
          every browser holding an older bundle the moment this deploys.
        */
        kind: z.enum(["upload", "url"]).optional(),
        // Absent for a link. Their presence is checked against `kind` below,
        // where a rule about two fields belongs.
        size: z.number().int().positive().optional(),
        mimeType: z.string().min(1).max(120).optional(),
        durationSeconds: z.number().positive().max(86_400).optional(),
        name: z.string().max(200).optional(),
        /*
          Bounded hard. This string reaches a URL parser, a database column and
          a log line, and 2000 characters is far beyond any real share link
          while being far below anything worth attacking a parser with.
        */
        url: z.string().min(4).max(2000).optional(),
      })
      .strict()
      /*
        The cross-field rule, here rather than in the route, so it is testable
        alongside the "a client cannot send user_id" guarantee.

        A `url` source that also carries a size and a MIME type is refused
        rather than having them ignored: those two fields are what the ceilings
        are checked against for an upload, and a body that sets them on a link
        is either a confused client or somebody hoping one of the two paths
        reads them.
      */
      .refine(
        (s) => (s.kind === "url" ? !!s.url : !!s.size && !!s.mimeType),
        { message: "a url source needs a url; an upload needs a size and a mimeType" },
      )
      .refine((s) => (s.kind === "url" ? s.size === undefined && s.mimeType === undefined : !s.url), {
        message: "size/mimeType belong to an upload, url belongs to a link — never both",
      }),
  })
  .strict();

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
