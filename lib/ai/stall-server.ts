import "server-only";

import { getUserAIEntitlement } from "@/lib/ai/entitlement";
import { aiFeature, type AiFeature } from "@/lib/ai/jobs";
import { transitionJob } from "@/lib/ai/job-store";
import { AI_STALL_DEADLINE_MS, stalledForMs, type StallableJob } from "@/lib/ai/stall";
import { releaseAiUsage } from "@/lib/ai/usage";

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
export async function failStalledJob(
  job: StallableJob & { user_id: string; feature: string },
  now: number = Date.now(),
): Promise<boolean> {
  const over = stalledForMs(job, now);
  if (over === null) return false;

  const def = aiFeature(job.feature);
  if (!def) return false;

  const ended = await transitionJob(job.id, [job.status], "failed", {
    error_code: "PROVIDER_TIMEOUT",
    error_message: `no provider callback ${Math.round((over + AI_STALL_DEADLINE_MS[job.status as "queued" | "processing" | "finalizing"]) / 60000)}m after ${job.status === "queued" ? "creation" : "start"}`,
    completed_at: new Date(now).toISOString(),
  });

  // Null means another poller got there first. Not an error, and NOT a second
  // refund — the winner already issued the only one.
  if (!ended) return false;

  try {
    const entitlement = await getUserAIEntitlement(job.user_id, def);
    await releaseAiUsage(job.user_id, def.id as AiFeature, entitlement.dailyLimit);
  } catch (e) {
    // The job is already correctly marked failed. A refund that did not land
    // is worth logging and is not worth reporting the job as still running.
    console.error("[ai/stall] refund failed", { jobId: job.id, error: String(e) });
  }

  console.warn("[ai/stall] failed a stalled job", {
    jobId: job.id,
    status: job.status,
    overdueMs: over,
  });
  return true;
}
