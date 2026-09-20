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
  /** Part 8 §17: queued jobs never started within a day — files removed, row expired. */
  abandoned: number;
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
  // `deleted` (Part 7) is swept by the delete route itself; the row stays for the ledger.
  (s) => !isActiveStatus(s) && s !== "expired" && s !== "deleted",
);

export async function runAiRetention(now: Date = new Date()): Promise<RetentionResult> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const result: RetentionResult = {
    expired: 0,
    sourcesReclaimed: 0,
    abandoned: 0,
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
    .select("id, status, source_path, result_path, poster_path, expires_at")
    .lte("expires_at", now.toISOString())
    .in("status", [...TERMINAL])
    .order("expires_at", { ascending: true })
    .limit(BATCH);

  if (expiredError) {
    console.error("[ai/retention] expired query failed", { message: expiredError.message });
    result.errors += 1;
  }

  for (const row of (expiredRows ?? []) as Pick<
    AiJobRow,
    "id" | "status" | "source_path" | "result_path" | "poster_path"
  >[]) {
    /*
      Part 6: a Character Replace job's folder holds more than its source —
      the reference photo(s), the prepared cut, the member's voice as
      uploaded, the prepared WAV, the replaced video brought home for lip
      sync. Voice files are the most private of these (§24). The whole
      folder goes, listed from the source path's own prefix; the three
      columns below are removed by name as before, so a row whose folder
      listing fails still loses what it names.
    */
    const swept = await removeJobFolder(admin, row.source_path);
    result.objectsDeleted += swept.deleted;
    result.errors += swept.errors;
    const removed = await removeObjects(admin, [
      { bucket: AI_SOURCE_BUCKET, path: row.source_path },
      { bucket: AI_RESULT_BUCKET, path: row.result_path },
      /*
        The tile's still frame (migration 0147). It expires WITH the video,
        because it is a frame of it — a poster outliving the file it was cut
        from would leave the one recognisable piece of somebody's private video
        in a bucket after the product told them it had been deleted.
      */
      { bucket: AI_RESULT_BUCKET, path: row.poster_path },
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
      .update({ status: "expired", source_path: null, result_path: null, poster_path: null })
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
    const swept = await removeJobFolder(admin, row.source_path);
    result.objectsDeleted += swept.deleted;
    result.errors += swept.errors;
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

  /*
    ── 3 · ABANDONED PROJECTS (Part 8 §17) ─────────────────────────────────

    A member creates a project, the browser uploads the photo and the video,
    and Start is never pressed — a closed tab, a change of mind. The row sits
    in `queued` with nothing to move it, `started_at` null, and the uploads
    stay in the private bucket until now. A day is long enough for anyone
    who meant to come back; after it the files go and the row reads
    `expired`, which the workspace already knows how to say. Nothing was
    ever reserved for such a row, so there is nothing to refund.
  */
  const { data: idleRows, error: idleError } = await admin
    .from("ai_jobs")
    .select("id, source_path")
    .eq("status", "queued")
    .is("started_at", null)
    .lte("created_at", new Date(now.getTime() - ABANDONED_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (idleError) {
    console.error("[ai/retention] abandoned query failed", { message: idleError.message });
    result.errors += 1;
  }
  const abandoned = await expireDrafts(admin, (idleRows ?? []) as Pick<AiJobRow, "id" | "source_path">[], now);
  result.abandoned += abandoned.expired;
  result.objectsDeleted += abandoned.objectsDeleted;
  result.errors += abandoned.errors;

  result.ms = Date.now() - startedAt;
  console.info("[ai/retention] swept", result);
  return result;
}

/** A queued project nobody started within this long is abandoned. */
const ABANDONED_AFTER_MS = 24 * 60 * 60_000;

/**
 * Expire never-started drafts: the folder's uploads go, the row reads
 * `expired`. Guarded on `queued` + `started_at is null` in the UPDATE, so a
 * draft that was started in the meantime is left exactly where /start put it.
 * Nothing was ever reserved for such a row, so there is nothing to refund.
 */
async function expireDrafts(
  admin: ReturnType<typeof createAdminClient>,
  rows: readonly Pick<AiJobRow, "id" | "source_path">[],
  now: Date,
): Promise<{ expired: number; objectsDeleted: number; errors: number }> {
  const out = { expired: 0, objectsDeleted: 0, errors: 0 };
  for (const row of rows) {
    const swept = await removeJobFolder(admin, row.source_path);
    out.objectsDeleted += swept.deleted;
    out.errors += swept.errors;
    // 🔴 The source itself too (Part 10): `removeJobFolder` spares the object the path names, and the abandoned sweep had been leaving every never-started upload in the bucket.
    const removed = await removeObjects(admin, [{ bucket: AI_SOURCE_BUCKET, path: row.source_path }]);
    out.objectsDeleted += removed.deleted;
    out.errors += removed.errors;
    const { data: moved, error } = await admin
      .from("ai_jobs")
      .update({ status: "expired", source_path: null, result_path: null, poster_path: null, completed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .is("started_at", null)
      .select("id");
    if (error) {
      console.error("[ai/retention] draft expire failed", { jobId: row.id, message: error.message });
      out.errors += 1;
      continue;
    }
    if ((moved?.length ?? 0) === 1) out.expired += 1;
  }
  return out;
}

/**
 * ── A NEW PROJECT SUPERSEDES THE MEMBER'S ABANDONED DRAFTS (Part 10) ─────────
 *
 * A Character Replace row is opened at Create and stays `queued` until the
 * uploads land and /start runs. When the upload fails, or the tab is closed,
 * the draft is left behind — and the member's next Create, on a new
 * clientRequestId, found it in the active count and answered "You already
 * have a video being made" until the daily abandoned sweep above cleared it.
 *
 * So the create route calls this first: every OTHER never-started draft of
 * the member's, for this feature, is expired the way the sweep would have
 * expired it a day later. A retry on the SAME clientRequestId never reaches
 * here (the route answers with the existing job), and a draft that has been
 * started is excluded by the `started_at is null` guard on both the read and
 * the write. Best-effort: a storage hiccup is logged and the row still moves,
 * so a member is never blocked by our own housekeeping.
 */
export async function supersedeOwnDrafts(userId: string, feature: AiJobRow["feature"], now: Date = new Date()): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_jobs")
    .select("id, source_path")
    .eq("user_id", userId)
    .eq("feature", feature)
    .eq("status", "queued")
    .is("started_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    console.error("[ai/retention] draft lookup failed", { userId, feature, message: error.message });
    return 0;
  }
  const rows = (data ?? []) as Pick<AiJobRow, "id" | "source_path">[];
  if (!rows.length) return 0;
  const done = await expireDrafts(admin, rows, now);
  if (done.expired > 0) console.info("[ai/retention] superseded drafts", { userId, feature, expired: done.expired, objectsDeleted: done.objectsDeleted, errors: done.errors });
  return done.expired;
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
/**
 * Every object beside the source in ITS job folder (`<user>/<feature>/<job>/`),
 * removed in one call. Listing then removing is two round trips per job; the
 * sweep runs in batches of a hundred on a cron, so that is fine. The source
 * itself is removed by name afterwards, whatever the listing said.
 */
export async function removeJobFolder(admin: ReturnType<typeof createAdminClient>, sourcePath: string | null): Promise<{ deleted: number; errors: number }> {
  if (!sourcePath) return { deleted: 0, errors: 0 };
  const segments = sourcePath.split("/");
  if (segments.length !== 4) return { deleted: 0, errors: 0 };
  const folder = segments.slice(0, 3).join("/");
  try {
    const { data, error } = await admin.storage.from(AI_SOURCE_BUCKET).list(folder, { limit: 100 });
    if (error) {
      console.warn("[ai/retention] folder list failed", { folder: folder.slice(-40), message: error.message });
      return { deleted: 0, errors: 1 };
    }
    const names = (data ?? []).map((o) => o.name).filter((n) => n && n !== segments[3]);
    if (!names.length) return { deleted: 0, errors: 0 };
    const { error: removeError } = await admin.storage.from(AI_SOURCE_BUCKET).remove(names.map((n) => `${folder}/${n}`));
    if (removeError) {
      console.warn("[ai/retention] folder remove failed", { folder: folder.slice(-40), message: removeError.message });
      return { deleted: 0, errors: 1 };
    }
    return { deleted: names.length, errors: 0 };
  } catch (e) {
    console.warn("[ai/retention] folder sweep threw", { error: e instanceof Error ? e.name : "unknown" });
    return { deleted: 0, errors: 1 };
  }
}

export async function removeObjects(
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

/**
 * Part 7 §20 — the member deleted a result. Every object of the job goes
 * (the source folder with its references, voice and intermediates; the
 * result; the poster) and the paths are cleared in the same update that
 * writes `deleted`. The row stays: the ledger and the audit events point at
 * it, and financial records are never deleted. Idempotent — a second call
 * finds nothing to remove and a row already `deleted`.
 */
export async function deleteAiJobResult(row: Pick<AiJobRow, "id" | "status" | "source_path" | "result_path" | "poster_path" | "metadata">): Promise<{ deleted: boolean; objectsDeleted: number; errors: number }> {
  const admin = createAdminClient();
  if (isActiveStatus(row.status)) return { deleted: false, objectsDeleted: 0, errors: 0 };
  const folderSource =
    row.source_path ??
    (typeof (row.metadata as { video?: { path?: unknown } } | null)?.video?.path === "string" ? ((row.metadata as { video: { path: string } }).video.path) : null);
  const swept = await removeJobFolder(admin, folderSource);
  const removed = await removeObjects(admin, [
    { bucket: AI_SOURCE_BUCKET, path: folderSource },
    { bucket: AI_RESULT_BUCKET, path: row.result_path },
    { bucket: AI_RESULT_BUCKET, path: row.poster_path },
  ]);
  const { data, error } = await admin
    .from("ai_jobs")
    .update({
      status: "deleted",
      source_path: null,
      result_path: null,
      poster_path: null,
      metadata: { ...(row.metadata ?? {}), deleted_at: new Date().toISOString(), provider_output_url: null },
    })
    .eq("id", row.id)
    .in("status", ["completed", "failed", "cancelled", "expired"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[ai/retention] delete failed", { jobId: row.id, message: error.message });
    return { deleted: false, objectsDeleted: swept.deleted + removed.deleted, errors: swept.errors + removed.errors + 1 };
  }
  return { deleted: !!data, objectsDeleted: swept.deleted + removed.deleted, errors: swept.errors + removed.errors };
}
