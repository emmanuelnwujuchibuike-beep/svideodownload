import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";

/**
 * The multi-video session, summarised (0166, brief §10): counts by what the
 * member sees — waiting, processing, completed, failed, cancelled — derived
 * from the rows every time, never stored. Pure, shared by the batch route,
 * the board and the tests, so "3 videos · 2 processing · 1 queued" cannot
 * be computed two ways.
 */
export interface BatchSummary {
  id: string;
  size: number;
  counts: { waiting: number; processing: number; completed: number; failed: number; cancelled: number; drafts: number };
  /** Something in the batch will still change on its own — drives polling. */
  active: boolean;
}

export function summarizeBatch(id: string, jobs: readonly Pick<AiJobView, "status">[]): BatchSummary {
  const counts = { waiting: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, drafts: 0 };
  for (const j of jobs) {
    if (j.status === "waiting") counts.waiting += 1;
    else if (j.status === "acquiring" || j.status === "processing" || j.status === "finalizing") counts.processing += 1;
    else if (j.status === "completed") counts.completed += 1;
    else if (j.status === "failed" || j.status === "expired") counts.failed += 1;
    else if (j.status === "cancelled" || j.status === "deleted") counts.cancelled += 1;
    else counts.drafts += 1;
  }
  return { id, size: jobs.length, counts, active: jobs.some((j) => isActiveStatus(j.status)) };
}

/** The member's sentence for a batch card header: "3 videos · 2 processing · 1 waiting". */
export function batchHeadline(summary: BatchSummary): string {
  const parts: string[] = [`${summary.size} video${summary.size === 1 ? "" : "s"}`];
  if (summary.counts.processing) parts.push(`${summary.counts.processing} processing`);
  if (summary.counts.waiting) parts.push(`${summary.counts.waiting} waiting`);
  if (summary.counts.completed) parts.push(`${summary.counts.completed} done`);
  if (summary.counts.failed) parts.push(`${summary.counts.failed} didn't finish`);
  if (summary.counts.cancelled) parts.push(`${summary.counts.cancelled} cancelled`);
  return parts.join(" · ");
}
