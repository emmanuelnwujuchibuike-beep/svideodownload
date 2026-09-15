import { isActiveStatus, type AiFeature, type AiJobStatus, type AiJobView } from "@/lib/ai/jobs";

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
    title: "Your transformations will appear here",
    body: "Create your first Character Replace video to see it here — it stays for a few days, longer when you save it.",
  },
  completed: {
    title: "No finished videos yet",
    body: "Once a video finishes processing, it waits here for a few days — longer when you save it.",
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
 * database can hold and the retention sweep now writes it (Part 7), but the
 * TIMESTAMP is still checked too: the sweep runs hourly, so there is always a
 * window where a file is past its promise and the row has not caught up. The
 * member should be told the truth in that window, not offered a dead link.
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
  deleted: { label: "Deleted", tone: "muted" },
};

export function historyChip(job: AiJobView, now: number): { label: string; tone: AiHistoryTone } {
  // An expired FILE under a completed row reads as expired, because that is
  // what the member can and cannot do with it.
  if (job.status === "completed" && resultAvailability(job, now) === "expired") return TONES.expired;
  return TONES[job.status];
}

/* ───────────────── what a row is, in the member's words ────────────────── */

/**
 * The fallback title when a job has no source name. Keyed by the tool that
 * made the row, because history outlives tools: an AI Clean row from before
 * 2026-09-13 is still a cleaned video, and calling it anything else would be a
 * lie about the member's own file.
 */
/**
 * "720p · 12.4 s · ₦310.00" — the facts a member may see about their own job
 * (Part 4, §24: thumbnail, date, duration, quality, status, cost). Never a
 * provider id, never a path. Null for any other tool.
 */
export function characterReplaceFacts(job: AiJobView): string | null {
  const cr = job.characterReplace;
  if (!cr) return null;
  // Part 6: the operation first — Face Only · Skin + Face · Full Character — then the tier.
  const parts: string[] = [MODE_LABEL[cr.mode] ?? "Full Character", TIER_LABEL[cr.quality] ?? cr.quality];
  if (cr.voiceMode === "new_voice") parts.push(cr.voiceSource === "tts" ? "new voice" : "your audio");
  if (cr.lipSyncMode) parts.push(`${cr.lipSyncMode} lip sync`);
  const seconds = cr.selectedDurationMs !== null ? cr.selectedDurationMs / 1000 : (job.result.durationSeconds ?? null);
  if (seconds !== null) parts.push(`${(Math.round(seconds * 10) / 10).toFixed(1)} s`);
  if (cr.chargedCents !== null && cr.chargedCents > 0) {
    const money = `${symbolFor(cr.currency)}${(cr.chargedCents / 100).toFixed(2)}`;
    parts.push(cr.refunded ? `${money} refunded` : money);
  }
  return parts.join(" · ");
}

const MODE_LABEL: Record<string, string> = { face_only: "Face Only", skin_face: "Skin + Face", full_character: "Full Character" };
const TIER_LABEL: Record<string, string> = { standard: "Standard", high: "High", ultra: "Ultra", "480p": "480p", "720p": "720p", "1080p": "1080p" };

function symbolFor(currency: string | null): string {
  switch (currency) {
    case "NGN":
      return "₦";
    case "USD":
      return "$";
    case "GHS":
      return "GH₵";
    default:
      return currency ? `${currency} ` : "";
  }
}

export function historyTitleFor(feature: AiFeature): string {
  switch (feature) {
    case "ai_character_replace":
      return "Character Replace video";
    case "ai_clean":
      return "Cleaned video";
    default:
      return "Frenz AI video";
  }
}

/**
 * The one sentence under the player: what happened to this video.
 *
 * `audioRestored` is three different truths — the sound is back, the source
 * never had any, or the row predates the column — and they are not
 * interchangeable: "no audio" and "we could not restore your audio" are
 * different claims and a member can tell.
 */
export function historyResultSentence(job: AiJobView): string {
  if (job.feature === "ai_character_replace") {
    const facts = characterReplaceFacts(job);
    const mode = job.characterReplace?.mode ?? "full_character";
    const what = mode === "face_only" ? "Face replaced" : mode === "skin_face" ? "Identity transferred" : "Character replaced";
    const sentence =
      job.characterReplace?.voiceApplied
        ? `${what}, with the new voice on it.`
        : job.result.audioRestored === false
          ? `${what}. This video had no sound to keep.`
          : mode === "full_character"
            ? `${what}, with the original movement and scene kept.`
            : `${what}, with the original body, clothes and scene kept.`;
    return facts ? `${sentence} ${facts}.` : sentence;
  }
  if (job.feature === "ai_clean") {
    return job.result.audioRestored === true
      ? "Text removed, original audio back on it."
      : job.result.audioRestored === false
        ? "Text removed. This video had no sound to restore."
        : "Text removed.";
  }
  return "Finished with Frenz AI.";
}
