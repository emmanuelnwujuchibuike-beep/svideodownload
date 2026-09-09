import "server-only";

import { AI_JOB_STATUSES, isActiveStatus, type AiJobRow, type AiJobStatus } from "@/lib/ai/jobs";
import { AI_RESULT_BUCKET, AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — DELETING WHAT WE PROMISED TO DELETE (Part 7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 THE PROMISE WAS ON SCREEN AND NOTHING KEPT IT ────────────────────────
 *
 * The result panel has told every member "Kept privately for three days, then
 * deleted" since Part 3. `expires_at` has been written on every row since Part
 * 2. `ai_jobs_expires_idx` was created for this sweep in migration 0142.
 *
 * And nothing has ever deleted a single object. `lib/ai/jobs.ts` says so in as
 * many words — "nothing deletes anything today" — so every source video and
 * every result any member has ever uploaded is still in the bucket.
 *
 * Two separate failures in one gap:
 *
 *   · a PRIVACY one. Somebody's unpublished footage is sitting in our storage
 *     indefinitely after we told them it would not be. That is the half that
 *     actually matters;
 *   · a COST one. Nothing bounds the growth, and the AI buckets share a
 *     Supabase project with a 5 GB ceiling this product has already hit once
 *     through two other doors.
 *
 * ── What gets deleted, and what does NOT ────────────────────────────────────
 *
 *   EXPIRED       a terminal job past `expires_at` — both objects go, and the
 *                 row is marked `expired` so history can say so honestly.
 *   DEAD SOURCES  a failed or cancelled job's source. No result is ever coming,
 *                 so the input is dead weight from the moment the job ended —
 *                 and it is the LARGER of the two files.
 *
 * 🔴 An ACTIVE job is never touched, whatever its timestamp says. A job can sit
 * in `processing` past its own expiry — the provider queues, and this project
 * has measured 19-minute runs — and deleting the source of a job that is still
 * running would break it mid-flight. `isActiveStatus` decides, never a date.
 *
 * 🔴 The ROW is never deleted, only its files. History is how a member knows
 * what they made, and a disappearing list is a worse answer than one that says
 * "this one expired". Rows are small; videos are not.
 *
 * ── Bounded by construction ────────────────────────────────────────────────
 *
 * One page per run, ordered oldest-first, with a hard ceiling. A sweep that
 * tried to catch up on a year of backlog in one invocation would time out
 * halfway and leave a mess; this one simply runs again.
 */

/** Jobs examined per run. Small enough to finish, large enough to keep up. */
const BATCH = 100;

export interface RetentionResult {
  /** Rows whose files were removed and which are now `expired`. */
  expired: number;
  /** Failed/cancelled jobs whose dead source was removed. */
  sourcesReclaimed: number;
  /** Objects actually deleted, across both buckets. */
  objectsDeleted: number;
  /** Storage errors — logged, never fatal. A retry gets them next run. */
  errors: number;
  ms: number;
}

/**
 * Terminal statuses. Everything not active, minus `expired` itself — a row
 * already swept has nothing left to remove and must not be counted again.
 */
const TERMINAL: readonly AiJobStatus[] = AI_JOB_STATUSES.filter(
  (s) => !isActiveStatus(s) && s !== "expired",
);

export async function runAiRetention(now: Date = new Date()): Promise<RetentionResult> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const result: RetentionResult = {
    expired: 0,
    sourcesReclaimed: 0,
    objectsDeleted: 0,
    errors: 0,
    ms: 0,
  };

  /*
    ── 1 · EXPIRED JOBS: both files go ────────────────────────────────────

    Filtered in SQL on the indexed column, and on TERMINAL statuses so an
    active job can never appear here however old it is. Oldest first, because
    the oldest is the one that has been over its promise the longest.
  */
  const { data: expiredRows, error: expiredError } = await admin
    .from("ai_jobs")
    .select("id, status, source_path, result_path, expires_at")
    .lte("expires_at", now.toISOString())
    .in("status", [...TERMINAL])
    .order("expires_at", { ascending: true })
    .limit(BATCH);

  if (expiredError) {
    console.error("[ai/retention] expired query failed", { message: expiredError.message });
    result.errors += 1;
  }

  for (const row of (expiredRows ?? []) as Pick<AiJobRow, "id" | "status" | "source_path" | "result_path">[]) {
    const removed = await removeObjects(admin, [
      { bucket: AI_SOURCE_BUCKET, path: row.source_path },
      { bucket: AI_RESULT_BUCKET, path: row.result_path },
    ]);
    result.objectsDeleted += removed.deleted;
    result.errors += removed.errors;

    /*
      🔴 The paths are CLEARED with the same update that sets `expired`.

      Leaving them would make `/api/ai/jobs/[id]/result` sign a url for an
      object that is gone — a member would get a link, tap it, and meet a 404
      from storage instead of the honest "this expired" the interface already
      knows how to render. The row's own state is what history reads.
    */
    const { error } = await admin
      .from("ai_jobs")
      .update({ status: "expired", source_path: null, result_path: null })
      .eq("id", row.id)
      .in("status", [...TERMINAL]);

    if (error) {
      console.error("[ai/retention] expire failed", { jobId: row.id, message: error.message });
      result.errors += 1;
      continue;
    }
    result.expired += 1;
  }

  /*
    ── 2 · DEAD SOURCES: a failed or cancelled job's input ────────────────

    No result is ever coming for these, so the source is dead the moment the
    job ended — and it is the bigger of the two files. Reclaimed WITHOUT
    touching the status: the member should still see "you stopped this one" in
    their history rather than have it renamed to expired.

    ⚠️ Only rows that still HAVE a source path, so a second run does no work
    and counts nothing.
  */
  const { data: deadRows, error: deadError } = await admin
    .from("ai_jobs")
    .select("id, source_path")
    .in("status", ["failed", "cancelled"])
    .not("source_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (deadError) {
    console.error("[ai/retention] dead-source query failed", { message: deadError.message });
    result.errors += 1;
  }

  for (const row of (deadRows ?? []) as Pick<AiJobRow, "id" | "source_path">[]) {
    const removed = await removeObjects(admin, [{ bucket: AI_SOURCE_BUCKET, path: row.source_path }]);
    result.objectsDeleted += removed.deleted;
    result.errors += removed.errors;

    const { error } = await admin
      .from("ai_jobs")
      .update({ source_path: null })
      .eq("id", row.id)
      .in("status", ["failed", "cancelled"]);

    if (error) {
      console.error("[ai/retention] source clear failed", { jobId: row.id, message: error.message });
      result.errors += 1;
      continue;
    }
    result.sourcesReclaimed += 1;
  }

  result.ms = Date.now() - startedAt;
  console.info("[ai/retention] swept", result);
  return result;
}

/**
 * Remove objects, tolerating everything.
 *
 * 🔴 A storage failure must NEVER stop the sweep. The next run tries again, and
 * one unreachable object is not a reason to leave the other ninety-nine files
 * in place — which is exactly what a throw here would do.
 *
 * A path that is already null is not an error and not a deletion; it is a job
 * that never got that far.
 */
async function removeObjects(
  admin: ReturnType<typeof createAdminClient>,
  targets: { bucket: string; path: string | null }[],
): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;

  for (const { bucket, path } of targets) {
    if (!path) continue;
    try {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) {
        console.warn("[ai/retention] remove failed", { bucket, message: error.message });
        errors += 1;
        continue;
      }
      deleted += 1;
    } catch (e) {
      console.warn("[ai/retention] remove threw", { bucket, error: e instanceof Error ? e.name : "unknown" });
      errors += 1;
    }
  }

  return { deleted, errors };
}
