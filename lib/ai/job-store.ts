import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import {
  AI_ACTIVE_STATUSES,
  canTransition,
  decodeCursor,
  encodeCursor,
  type AiFeature,
  type AiFeatureDef,
  type AiJobRow,
  type AiJobSourceInput,
  type AiJobStatus,
} from "@/lib/ai/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — every database access the job system makes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 TWO CLIENTS, ON PURPOSE ───────────────────────────────────────────────
 *
 * READS go through the member's OWN Supabase client, so the `ai_jobs_select_own`
 * policy is what decides whether a row comes back. Every query here also filters
 * by `user_id` explicitly — belt and braces, and the belt is the one that would
 * still hold if somebody deleted the buckle. It is worth being specific about
 * why this is the stronger choice: with the service role, a single mistyped
 * filter in a future edit returns somebody else's job and nothing anywhere
 * objects. With the member's client, that same mistake returns nothing. The
 * policy is also then exercised on every single read in production, so it
 * cannot quietly be wrong.
 *
 * WRITES go through the service role, because there is deliberately no insert
 * or update policy for anyone. A browser cannot create a job, move a status,
 * name a provider or set a `result_path` — and neither can a bug in code that
 * runs with the member's key.
 *
 * ── No file ever passes through here ─────────────────────────────────────────
 *
 * Rows only. This module is called from HTTP request handlers, which must stay
 * fast: validate, write one row, answer. Nothing downloads, uploads, transcodes
 * or waits on a provider.
 */

/** The columns a job read ever needs. `error_message` is deliberately absent. */
const JOB_COLUMNS =
  "id, user_id, feature, provider, model, model_version, status, client_request_id, source_path, result_path, source_size, result_size, result_duration, result_mime_type, audio_restored, source_duration, source_mime_type, replicate_prediction_id, error_code, created_at, started_at, completed_at, expires_at, metadata";

/** Postgres unique-violation. The idempotency race lands here. */
const UNIQUE_VIOLATION = "23505";

/**
 * One job, but only if it is this member's.
 *
 * The user's own client plus an explicit filter: an id belonging to somebody
 * else returns null rather than a row, and it does so twice over.
 */
export async function getOwnJob(userId: string, jobId: string): Promise<AiJobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  // A PostgREST failure is a resolved `{ error }`, never a throw — treating it
  // as "no job" would turn an outage into a 404 storm, so it is logged and
  // raised as the failure it is.
  if (error) {
    console.error("[ai/jobs] read failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return (data as AiJobRow | null) ?? null;
}

export interface AiJobPage {
  rows: AiJobRow[];
  /** Opaque. Pass it back to continue; null when there is nothing after this. */
  nextCursor: string | null;
}

/**
 * A page of this member's history, newest first.
 *
 * ── Keyset, not offset ───────────────────────────────────────────────────────
 * `offset` re-scans everything it skips, so page 40 costs forty times page 1 and
 * a row inserted mid-scroll shifts every subsequent page by one. The cursor
 * carries the last row's `created_at` AND its id, because two jobs created in
 * the same millisecond are ordinary and a timestamp alone would either repeat a
 * row or skip one.
 */
export async function listOwnJobs(
  userId: string,
  opts: { limit: number; cursor?: string | null; feature?: AiFeature | null; activeOnly?: boolean },
): Promise<AiJobPage> {
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit)));
  const supabase = await createClient();

  let query = supabase
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One more than asked for: whether a next page exists is answered by
    // fetching a row we then throw away, not by a second COUNT query.
    .limit(limit + 1);

  if (opts.feature) query = query.eq("feature", opts.feature);
  // The "what was I doing?" query a returning member's page runs. Narrowing in
  // SQL rather than fetching a page and filtering it in the browser: an active
  // job is rare, so the alternative reads twenty rows to find none.
  if (opts.activeOnly) query = query.in("status", [...AI_ACTIVE_STATUSES]);

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[ai/jobs] list failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }

  const rows = (data as AiJobRow[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/** How many of this member's jobs are still going to change. */
export async function countActiveJobs(userId: string, feature: AiFeature): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("feature", feature)
    .in("status", [...AI_ACTIVE_STATUSES]);

  if (error) {
    console.error("[ai/jobs] active count failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return count ?? 0;
}

/** The job this member already created with this request id, if any. */
export async function findJobByRequestId(
  userId: string,
  clientRequestId: string,
): Promise<AiJobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();

  if (error) {
    console.error("[ai/jobs] idempotency lookup failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return (data as AiJobRow | null) ?? null;
}

export interface CreateJobInput {
  userId: string;
  feature: AiFeatureDef;
  source: AiJobSourceInput;
  clientRequestId: string;
}

export type CreateJobResult =
  | { created: true; row: AiJobRow }
  /** The same request id already had a job. Returned instead of a second one. */
  | { created: false; row: AiJobRow };

/**
 * Write the job.
 *
 * ── What the server decides, and the client cannot ───────────────────────────
 * `user_id` (from the session), `provider` (from the registry), `status`
 * (always `queued`), `expires_at` (from the feature's retention) and both paths
 * (null — nothing is stored yet). The client contributes a description of its
 * input and an idempotency key, and nothing else on the row.
 *
 * ── The race the unique index closes ─────────────────────────────────────────
 * Two taps on a slow connection can reach here at the same moment, both having
 * found no existing job a millisecond earlier. One insert wins; the other comes
 * back as a unique violation, and this returns the winner's row rather than an
 * error. That is what makes retrying safe rather than expensive.
 */
export async function createJob(input: CreateJobInput): Promise<CreateJobResult> {
  const { userId, feature, source, clientRequestId } = input;
  const admin = createAdminClient();

  const expiresAt = new Date(Date.now() + feature.retentionHours * 3_600_000).toISOString();

  const { data, error } = await admin
    .from("ai_jobs")
    .insert({
      user_id: userId,
      feature: feature.id,
      provider: feature.provider,
      status: "queued",
      client_request_id: clientRequestId,
      source_size: Math.round(source.size),
      source_mime_type: source.mimeType.trim().toLowerCase(),
      source_duration: source.durationSeconds ?? null,
      expires_at: expiresAt,
      // The filename is kept for the member's own history and nothing else. It
      // is their text, so it is bounded before it is stored.
      metadata: source.name ? { source_name: source.name.slice(0, 200) } : {},
    })
    .select(JOB_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const existing = await findJobByRequestId(userId, clientRequestId);
      if (existing) return { created: false, row: existing };
    }
    console.error("[ai/jobs] insert failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return { created: true, row: data as AiJobRow };
}


/* ═══════════════════ Part 3 — moving a job through its life ════════════════ */

/**
 * The service-role read the WEBHOOK needs.
 *
 * 🔴 The one read in this file with no user in scope, because a webhook has no
 * session — it arrives from Replicate carrying a prediction id and nothing
 * else. That is exactly why the caller must have verified the request's
 * signature FIRST: without that, this function is "look up any job by a value
 * that appears in our own logs".
 *
 * The unique index on `replicate_prediction_id` is what makes one callback
 * resolve to one job.
 */
export async function findJobByPredictionId(predictionId: string): Promise<AiJobRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("replicate_prediction_id", predictionId)
    .maybeSingle();

  if (error) {
    console.error("[ai/jobs] prediction lookup failed", { code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return (data as AiJobRow | null) ?? null;
}

/** Fields a status change may carry with it. All server-decided. */
export interface JobPatch {
  source_path?: string | null;
  /**
   * Replaced wholesale, never merged. The only writer is the finalizer,
   * clearing the provider URL it has finished with — a partial update here
   * would need a read-modify-write and a race to go with it.
   */
  metadata?: Record<string, unknown>;
  result_duration?: number | null;
  result_mime_type?: string | null;
  audio_restored?: boolean | null;
  source_size?: number | null;
  source_mime_type?: string | null;
  result_path?: string | null;
  result_size?: number | null;
  replicate_prediction_id?: string | null;
  model?: string | null;
  model_version?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/**
 * Move a job to a new status, but only from a status it is allowed to leave.
 *
 * ── 🔴 COMPARE-AND-SET, WHICH IS WHAT MAKES THE WEBHOOK IDEMPOTENT ───────────
 *
 * The `.in("status", from)` filter is part of the UPDATE, not a check before
 * it. Two deliveries of the same callback race: the first updates the row and
 * the second matches nothing, because the status it required is no longer
 * there. No locks, no transaction, no "have we seen this id" table — the same
 * shape as the atomic reservation in Part 2, for the same reason.
 *
 * Returns the updated row, or null when the transition did not apply. Null is
 * the ordinary case for a retry and callers treat it as success.
 *
 * `canTransition` is asserted as well, because a legal-looking pair that the
 * state machine forbids (completed -> processing, say) is a bug worth refusing
 * loudly rather than writing.
 */
export async function transitionJob(
  jobId: string,
  from: readonly AiJobStatus[],
  to: AiJobStatus,
  patch: JobPatch = {},
): Promise<AiJobRow | null> {
  for (const source of from) {
    if (source !== to && !canTransition(source, to)) {
      throw new AiJobError("INTERNAL_ERROR", `illegal transition ${source} -> ${to}`);
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_jobs")
    .update({ status: to, ...patch })
    .eq("id", jobId)
    .in("status", [...from])
    .select(JOB_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[ai/jobs] transition failed", { jobId, to, code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return (data as AiJobRow | null) ?? null;
}

/**
 * Record what was really uploaded, without changing the job's status.
 *
 * Separate from the transition above because it happens while the job is still
 * `queued` and may happen more than once: a member who re-uploads before
 * starting is not a state change, it is a correction.
 */
export async function recordUploadedSource(
  jobId: string,
  source: { path: string; size: number; mimeType: string | null },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_jobs")
    .update({
      source_path: source.path,
      source_size: source.size,
      source_mime_type: source.mimeType,
    })
    .eq("id", jobId)
    .eq("status", "queued");

  if (error) {
    console.error("[ai/jobs] source record failed", { jobId, code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
}

/**
 * Record WHERE this job's source will live, before it is uploaded.
 *
 * 🔴 The path is written when the upload ticket is minted, not re-derived at
 * start time. The first version of this flow rebuilt the key from the file's
 * MIME type when processing began — and a member whose file was named
 * `clip.mov` but typed `video/mp4` by their picker got a ticket for
 * `source.mov` and a lookup for `source.mp4`. The upload was fine; the
 * server simply looked in the wrong place and reported that nothing had been
 * uploaded. One recorded value, read back, cannot drift from itself.
 *
 * `source_size` and `source_mime_type` stay as the client CLAIMED them until
 * the upload is verified, at which point `recordUploadedSource` overwrites both
 * with what storage actually holds.
 */
export async function reserveSourcePath(jobId: string, path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_jobs")
    .update({ source_path: path })
    .eq("id", jobId)
    .eq("status", "queued");
  if (error) {
    console.error("[ai/jobs] path reserve failed", { jobId, code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
}

/**
 * One job, read WITHOUT a session.
 *
 * 🔴 The service-role read the WORKER needs, and the second one in this file
 * with no user in scope. The finalizer runs on a different machine, invoked by
 * a webhook, with no cookie anywhere in the chain — so ownership cannot be
 * enforced by RLS here and is enforced by what the caller is allowed to be
 * instead: the route in front of this requires the shared worker secret, and
 * the job id it passes came from a signature-verified provider callback.
 *
 * Every path this returns is then re-checked against `job.user_id` before it
 * becomes a signed URL (see pathBelongsTo), so a wrong id cannot become access
 * to somebody else's file.
 */
export async function getJobAsService(jobId: string): Promise<AiJobRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("ai_jobs").select(JOB_COLUMNS).eq("id", jobId).maybeSingle();

  if (error) {
    console.error("[ai/jobs] service read failed", { jobId, code: error.code, message: error.message });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
  return (data as AiJobRow | null) ?? null;
}

/**
 * Record the provider's output URL so the finalizer can fetch it.
 *
 * ⚠️ Deliberately transient. It is a link on the PROVIDER's infrastructure that
 * expires on their schedule, it is stored only between the webhook and the mux,
 * and the finalizer clears it on success. It never reaches a client:
 * `jobToView` reads exactly one key out of `metadata` and this is not it.
 *
 * Not a column, because a column implies something worth keeping. This is a
 * baton being passed between two machines.
 */
export async function recordProviderOutput(jobId: string, url: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error: readError } = await admin
    .from("ai_jobs")
    .select("metadata")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) {
    console.error("[ai/jobs] provider output read failed", { jobId, code: readError.code });
    throw new AiJobError("INTERNAL_ERROR", readError.message);
  }

  const existing = (data?.metadata ?? {}) as Record<string, unknown>;
  const { error } = await admin
    .from("ai_jobs")
    .update({ metadata: { ...existing, provider_output_url: url } })
    .eq("id", jobId)
    .eq("status", "processing");

  if (error) {
    console.error("[ai/jobs] provider output write failed", { jobId, code: error.code });
    throw new AiJobError("INTERNAL_ERROR", error.message);
  }
}
