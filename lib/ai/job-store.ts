import "server-only";

import { AiJobError } from "@/lib/ai/errors";
import {
  AI_ACTIVE_STATUSES,
  decodeCursor,
  encodeCursor,
  type AiFeature,
  type AiFeatureDef,
  type AiJobRow,
  type AiJobSourceInput,
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
  "id, user_id, feature, provider, model, model_version, status, client_request_id, source_path, result_path, source_size, result_size, source_duration, source_mime_type, replicate_prediction_id, error_code, created_at, started_at, completed_at, expires_at, metadata";

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
  opts: { limit: number; cursor?: string | null; feature?: AiFeature | null },
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
