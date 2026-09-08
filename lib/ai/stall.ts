import { isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the failure nobody reports
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every other way an AI job can fail arrives as an event: the provider calls
 * back, an upload throws, the worker answers. This one is the absence of an
 * event. A prediction that is dropped, a webhook that never reaches us, a
 * worker that dies mid-mux — the row simply stays `processing`, and nothing in
 * the system is waiting to notice.
 *
 * ── 🔴 WHY THIS EXISTS (found 2026-09-08, while the owner was testing) ───────
 *
 * The owner reported "it's been up to 5 minutes and still not done". The job
 * was genuinely running — it had a prediction id and a pinned version, the
 * first one ever to get past `402 Insufficient credit`. But looking for a
 * timeout to quote them, there wasn't one: **no code path in this product
 * could ever end that job.** Not a cron (there is no AI sweep), not the poll
 * (it only reads), not the webhook (it never came). A dropped callback meant a
 * spinner until the tab closed, and a daily allowance slot reserved forever.
 *
 * So the deadline is not a nicety. It is the only thing that can distinguish
 * "still working" from "never coming back", and it is what gives the member
 * their allowance back when the answer is the second one.
 *
 * ── Deliberately generous ────────────────────────────────────────────────────
 *
 * These numbers kill jobs, so they are set well past the worst legitimate run
 * rather than near the average one. Video inpainting at 720p is minutes of GPU
 * time for a short clip, and a cold model container adds more before a single
 * frame is touched; a 19-minute job was observed running normally on the day
 * this was written. A deadline that fires on a slow-but-healthy job is worse
 * than no deadline, because it charges the member an error for our impatience.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 *
 * On READ, from the poll the waiting member is already making — so the person
 * who cares learns the moment the deadline passes, with no scheduler involved
 * and no Vercel cron slot spent (the two this project has are long gone). A
 * job nobody is polling is swept the next time its owner opens the feature.
 * That is deliberately not "immediately": nothing is charged for a stalled job
 * and nothing is running, so the only cost of a late sweep is a stale row.
 */

/**
 * How long each stage may take before it is considered dead, in milliseconds.
 *
 * Measured from `started_at` where there is one (the moment the provider was
 * actually asked to do something) and from `created_at` before that. The
 * `finalizing` budget is the whole provider window PLUS the mux, because the
 * database records no `finalizing_at` — using the same clock for both stages
 * is honest about what we can actually measure, and errs long.
 */
export const AI_STALL_DEADLINE_MS: Record<"queued" | "processing" | "finalizing", number> = {
  /*
    A queued job is waiting for its own uploader. The browser holds the file
    and PUTs it straight to storage, so this covers a slow phone on a bad
    connection finishing a 100 MB upload — and nothing more, because after the
    upload the start request follows immediately.
  */
  queued: 30 * 60 * 1000,
  /*
    The provider window: queue time, cold start, download, inpaint, upload.
    The longest stretch by far and the one with the least visibility, so it
    gets the most room.
  */
  processing: 45 * 60 * 1000,
  /*
    Our own worker muxing the original audio back on. Fast — an ffmpeg copy of
    two streams — but measured from the same clock as `processing`, so this is
    the provider budget plus a mux budget, not fifteen minutes on its own.
  */
  finalizing: 60 * 60 * 1000,
};

export interface StallableJob {
  id: string;
  status: AiJobStatus;
  created_at: string;
  started_at?: string | null;
}

/**
 * How far past its deadline this job is, in milliseconds — or null if it is
 * fine, finished, or not a stage with a deadline.
 *
 * Pure, so the numbers above can be tested without a database or a clock.
 * `now` is injected for the same reason.
 */
export function stalledForMs(job: StallableJob, now: number = Date.now()): number | null {
  if (!isActiveStatus(job.status)) return null;

  const deadline = AI_STALL_DEADLINE_MS[job.status as "queued" | "processing" | "finalizing"];
  if (!deadline) return null;

  /*
    `started_at` is when the provider was engaged. Before that there is only
    `created_at`. Falling back rather than refusing to judge matters: a job
    that never started is exactly the kind that stalls, and requiring the
    timestamp it never got would exempt it forever.
  */
  const since = job.status === "queued" ? job.created_at : (job.started_at ?? job.created_at);
  const startedAt = Date.parse(since);
  // An unparseable timestamp is a reason to do nothing, not a reason to fail
  // somebody's job — `NaN` comparisons are false, so this is belt and braces.
  if (!Number.isFinite(startedAt)) return null;

  const over = now - startedAt - deadline;
  return over > 0 ? over : null;
}
