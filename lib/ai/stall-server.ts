import "server-only";

import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorMessage } from "@/lib/ai/errors";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { transitionJob } from "@/lib/ai/job-store";
import { getLandingSettings } from "@/lib/landing/settings";
import { notifyAiJobFailed } from "@/lib/ai/notify";
import { AI_STALL_DEADLINE_MS, stalledForMs, type StallableJob, stallDeadlineMs, type StallOverrides } from "@/lib/ai/stall";
import { subjectFromRow } from "@/lib/ai/subject";
import { releaseJobFunding } from "@/lib/ai/funding";

/**
 * End a job that is past its deadline, and give the allowance back.
 *
 * Returns true when this call is the one that ended it.
 *
 * ── 🔴 THE REFUND IS THE POINT ───────────────────────────────────────────────
 *
 * The owner's Part 5 brief and the newer usage architecture both say the same
 * thing: a member must not be charged for a failure that was ours. A stalled
 * job is the purest case of that — they chose a file, we took a slot, and
 * nothing ever happened. `releaseAiUsage` is capped per day (see usage.ts), so
 * this cannot become a way to farm free runs by making jobs hang.
 *
 * ── Compare-and-set, so two pollers cannot both refund ───────────────────────
 *
 * `transitionJob` puts the expected status inside the UPDATE. Two tabs polling
 * the same stalled job race, one row is updated, the other matches nothing and
 * returns null — so exactly one refund is issued, by the database, not by
 * whichever check happened to run first.
 */
/** The operator's processing deadline, read from the cached settings; the defaults when the read fails. */
async function processingOverrides(): Promise<StallOverrides | undefined> {
  try {
    const settings = await getLandingSettings();
    return { processing: settings.frenzAiCharacterReplace.processing.jobTimeoutMinutes * 60_000 };
  } catch {
    return undefined;
  }
}

export async function failStalledJob(
  job: StallableJob & {
    user_id?: string | null;
    guest_id?: string | null;
    feature: string;
    /**
     * 🔴 REQUIRED, not optional, and that is deliberate. This decides whether
     * the undo gives back a daily slot or gives back money, and the two are not
     * interchangeable — releasing a slot for a paid job creates a free video
     * (see lib/ai/funding.ts). Making it optional would let a caller omit it
     * and get the free branch silently; making it required means the compiler
     * asks every caller whether their query selects the column.
     *
     * Null is fine and means "free": every row that predates migration 0150
     * was funded by the daily allowance.
     */
    funding_source: "free" | "balance" | "credits" | null;
  },
  now: number = Date.now(),
): Promise<boolean> {
  /*
    ── 🔴 A CHARACTER REPLACE DRAFT IS NOT A STALLED JOB (Part 10, 2026-09-20) ──

    A `queued` Character Replace row is a project the member has opened and
    not yet started: the browser is still PUTting the video, or the tab was
    closed before Create. No provider was engaged, nothing was reserved, and
    the member has nothing to be told. Measured from `created_at` against the
    30-minute `queued` deadline, the 10-minute sweep was ending every slow
    upload as `failed / PROVIDER_TIMEOUT` and pushing "Character Replace
    couldn't finish" for a video that never ran — and the 24-hour abandoned
    sweep in lib/ai/retention.ts, which owns these rows, never got its turn.
    /start moves queued → acquiring inside one request, so a Character
    Replace row with a prediction id is never `queued`; the stall table's
    other stages are untouched.
  */
  if (job.feature === "ai_character_replace" && job.status === "queued") return false;
  // 0166: the operator's "Job timeout" (AI → Processing) is the processing deadline for Character Replace; the table's floor still applies.
  const overrides = job.feature === "ai_character_replace" ? await processingOverrides() : undefined;
  const over = stalledForMs(job, now, overrides);
  if (over === null) return false;

  const def = aiFeature(job.feature);
  if (!def) return false;

  const ended = await transitionJob(job.id, [job.status], "failed", {
    error_code: "PROVIDER_TIMEOUT",
    error_message: `no provider callback ${Math.round((over + stallDeadlineMs(job.status as "queued" | "waiting" | "acquiring" | "processing" | "finalizing", overrides)) / 60000)}m after ${job.status === "queued" || job.status === "waiting" ? "creation" : "start"}`,
    completed_at: new Date(now).toISOString(),
  });

  // Null means another poller got there first. Not an error, and NOT a second
  // refund — the winner already issued the only one.
  if (!ended) return false;

  // 🔴 Read off the ROW. A stalled job may belong to a guest, and this path
  // runs with no request and no session to resolve one from — the row is the
  // only place that records whose allowance to give back.
  const subject = subjectFromRow(job);
  try {
    if (subject) {
      const entitlement = await getAiEntitlement(subject, def);
      // Money back for a paid job, a daily slot for a free one — the row says
      // which, because guessing creates free videos (lib/ai/funding.ts).
      await releaseJobFunding({
        cause: "failure",
        job: { id: job.id, user_id: job.user_id ?? null, funding_source: job.funding_source },
        subject,
        feature: def.id as AiFeature,
        dailyLimit: entitlement.dailyLimit,
      });
    }
  } catch (e) {
    // The job is already correctly marked failed. A refund that did not land
    // is worth logging and is not worth reporting the job as still running.
    console.error("[ai/stall] refund failed", { jobId: job.id, error: String(e) });
  }

  /*
    They stopped watching long before this — the deadline is measured in tens
    of minutes. A push is the only way they learn, and it says the allowance
    came back because otherwise a timeout reads as a wasted run.
  */
  // Only a signed-in member has somewhere to receive a push. A guest gets the
  // answer from the page when they come back, which is the honest limit of not
  // asking anyone to sign up.
  if (subject?.kind === "user") {
    await notifyAiJobFailed({
      userId: subject.userId,
      jobId: job.id,
      feature: def.id,
      message: aiErrorMessage("PROVIDER_TIMEOUT"),
      // Ours, not the member's file — so the copy says "something went wrong"
      // rather than sending them to find a different video.
      errorCode: "PROVIDER_TIMEOUT",
    });
  }

  console.warn("[ai/stall] failed a stalled job", {
    jobId: job.id,
    status: job.status,
    overdueMs: over,
  });
  return true;
}
