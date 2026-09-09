import { isActiveStatus, type AiJobStatus, type AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the rules behind the history section
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "if a job finishes while I'm outside the page or the app,
 * it just disappears. I want a section on the AI page showing completed,
 * cancelled and all past jobs, so I can come back and still see the video that
 * was made."
 *
 * ── 🔴 A FILTER IS A DATABASE QUERY, NOT AN ARRAY FILTER ────────────────────
 *
 * The list is keyset-paged, so filtering a fetched page in the browser is
 * broken by construction: a page of twenty rows can hold zero cancelled jobs,
 * and "Cancelled" would render empty next to a "Show more" button that has to
 * be pressed an unknown number of times before anything appears. Each filter is
 * therefore a set of statuses that goes to the server as a query parameter and
 * reaches `status = any(...)` in Postgres.
 *
 * That is the only reason this module exists as its own file: the mapping from
 * a tab somebody taps to the statuses that tab means is the thing both the
 * browser and the route handler have to agree on, and agreeing by writing it
 * twice is how they stop agreeing.
 *
 * Pure: no React, no fetch, no clock of its own. `now` is always passed in.
 */

/** The tabs, in the order they are drawn. The owner named these three. */
export type AiHistoryFilter = "all" | "completed" | "cancelled";

export const AI_HISTORY_FILTERS: readonly AiHistoryFilter[] = ["all", "completed", "cancelled"] as const;

export function isAiHistoryFilter(value: string): value is AiHistoryFilter {
  return (AI_HISTORY_FILTERS as readonly string[]).includes(value);
}

/**
 * Which statuses a tab asks the server for.
 *
 * 🔴 `all` is an EMPTY list, meaning "do not filter" — deliberately not the
 * seven statuses spelled out. A status added to `ai_jobs` later would otherwise
 * be invisible under a tab whose own name promises it is showing everything,
 * and nothing would fail: the query would simply stop returning rows nobody
 * remembered to add. Absent means unfiltered, so `all` cannot rot.
 */
export function statusesForFilter(filter: AiHistoryFilter): readonly AiJobStatus[] {
  switch (filter) {
    case "completed":
      return ["completed"];
    /*
      A member who taps "Cancelled" is asking "what did I stop?" — and from
      where they sit a job the pipeline gave up on is the same shape of answer
      as one they stopped themselves: work that produced no video. `failed`
      belongs here rather than in a fourth tab the owner did not ask for, and
      the row still says which of the two it was.
    */
    case "cancelled":
      return ["cancelled", "failed"];
    case "all":
    default:
      return [];
  }
}

export const AI_HISTORY_FILTER_LABELS: Record<AiHistoryFilter, string> = {
  all: "All",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** What the empty list should say, per tab. Never a bare "Nothing here". */
export const AI_HISTORY_EMPTY_COPY: Record<AiHistoryFilter, { title: string; body: string }> = {
  all: {
    title: "Nothing here yet",
    body: "Videos you clean with Frenz AI show up here, so you can come back for them later.",
  },
  completed: {
    title: "No finished videos yet",
    body: "Once a video finishes cleaning, it waits here for three days.",
  },
  cancelled: {
    title: "Nothing was stopped",
    body: "Videos you cancel, and any that don't finish, are listed here.",
  },
};

/**
 * Whether the finished file is still there to play.
 *
 * ── 🔴 `completed` DOES NOT MEAN "PLAYABLE" ─────────────────────────────────
 *
 * The row is kept; the file is not. `expires_at` is three days after creation
 * (`feature.retentionHours`), and a completed job past it has a result path
 * pointing at an object that is either gone or on its way out. A history list
 * that offered Play on those rows would hand somebody a spinner and then an
 * error, for a video the product had already told them it deletes.
 *
 * So the row says so BEFORE it is tapped. `expired` is a real status the
 * database can hold, and the timestamp is checked as well, because nothing in
 * this project writes that status yet — see the note in the section component.
 */
export type AiResultAvailability = "ready" | "expired" | "pending" | "none";

export function resultAvailability(job: AiJobView, now: number): AiResultAvailability {
  if (job.status === "expired") return "expired";
  if (isActiveStatus(job.status)) return "pending";
  if (job.status !== "completed") return "none";
  const expiry = job.expiresAt ? Date.parse(job.expiresAt) : NaN;
  if (Number.isFinite(expiry) && expiry <= now) return "expired";
  return "ready";
}

/** True while a row must keep being re-read, which is what drives the poll. */
export function historyHasActive(jobs: readonly AiJobView[]): boolean {
  return jobs.some((job) => isActiveStatus(job.status));
}

/**
 * How long the member has left, as a number of whole hours.
 *
 * Null when there is nothing to say — no expiry recorded, or already gone.
 * Hours rather than a date because "available until Thursday 04:12" is a
 * precision nobody needs and the retention window is only ever three days.
 */
export function hoursUntilExpiry(job: AiJobView, now: number): number | null {
  if (!job.expiresAt) return null;
  const expiry = Date.parse(job.expiresAt);
  if (!Number.isFinite(expiry)) return null;
  const remaining = expiry - now;
  if (remaining <= 0) return null;
  return Math.max(1, Math.round(remaining / 3_600_000));
}

/**
 * The one-word state a row wears, and the tone it wears it in.
 *
 * 🔴 A total `Record` over `AiJobStatus` rather than a written-out list, so a
 * status added to the union fails the build here instead of rendering as an
 * empty chip on a row nobody thought about.
 */
export type AiHistoryTone = "active" | "good" | "muted" | "warn";

const TONES: Record<AiJobStatus, { label: string; tone: AiHistoryTone }> = {
  queued: { label: "Queued", tone: "active" },
  // Part 6: our worker is fetching a pasted link. Said as what it is, because a
  // row that said "Working" would claim the AI had started when it has not.
  acquiring: { label: "Fetching", tone: "active" },
  processing: { label: "Working", tone: "active" },
  finalizing: { label: "Finishing", tone: "active" },
  completed: { label: "Ready", tone: "good" },
  failed: { label: "Didn't finish", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
};

export function historyChip(job: AiJobView, now: number): { label: string; tone: AiHistoryTone } {
  // An expired FILE under a completed row reads as expired, because that is
  // what the member can and cannot do with it.
  if (job.status === "completed" && resultAvailability(job, now) === "expired") return TONES.expired;
  return TONES[job.status];
}

