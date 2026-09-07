import type { AiJobStatus, AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — what the member is told is happening, and why it is only that
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One mapping from a job's real state to a stage on screen. Pure, so the whole
 * progress display can be tested without a browser, and singular, so the
 * workspace, the processing panel and any future history row cannot disagree
 * about what "processing" looks like.
 *
 * ── 🔴 EVERY STAGE HERE IS ONE WE ACTUALLY OBSERVE ───────────────────────────
 *
 * The owner's brief lists five stages: Uploading, Queued, Analyzing video,
 * Removing text, Finalizing, Ready. Four of those are real signals we hold —
 * the upload is ours, `queued` and `processing` come from the job row, and
 * `completed` is the webhook.
 *
 * "Analyzing video" and "Finalizing" are NOT separate signals. The model does
 * detection and inpainting inside one Replicate prediction that reports a
 * single `processing` state, and our copy of the result happens inside the
 * webhook, where the row still says `processing`. Showing them as the current
 * step would mean deciding by a timer that analysis "must be done by now" —
 * which is the same lie as a percentage that counts itself up, wearing a
 * different label. The brief is explicit: never show a number, or a stage, the
 * backend does not know.
 *
 * So both appear in the PATH — the member can see the whole journey, which is
 * most of what those labels were for — and neither is ever announced as
 * current. If a later part subscribes to Replicate's log stream, they become
 * real signals and this file is where they turn on.
 */

export type AiCleanStage =
  | "idle"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface StageView {
  stage: AiCleanStage;
  /** The line under the heading. Present tense, no jargon, no percentages. */
  label: string;
  /** A second line, when there is something worth adding. */
  detail: string | null;
  /** 0-1, by STAGE not by guesswork. Null while nothing is running. */
  progress: number | null;
  /** Whether this state can still change on its own. Drives polling. */
  active: boolean;
}

/** The journey, shown in full so somebody waiting knows what is left. */
export const AI_CLEAN_PATH: readonly { key: string; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "queued", label: "Queued" },
  { key: "analyzing", label: "Analyzing video" },
  { key: "removing", label: "Removing text" },
  { key: "finalizing", label: "Finalizing" },
  { key: "ready", label: "Ready" },
] as const;

/**
 * Which path steps are done, doing, and to come.
 *
 * 🔴 `analyzing` and `finalizing` are never returned as `current` — see the
 * note at the top. While the job is processing they read as "doing" together
 * with `removing`, because all three are genuinely underway inside one
 * prediction and pretending to know which would be the fabrication.
 */
export function pathState(stage: AiCleanStage): Record<string, "done" | "doing" | "todo"> {
  const state: Record<string, "done" | "doing" | "todo"> = {};
  const mark = (keys: string[], value: "done" | "doing" | "todo") => {
    for (const k of keys) state[k] = value;
  };

  mark(AI_CLEAN_PATH.map((p) => p.key), "todo");

  if (stage === "uploading") {
    mark(["uploading"], "doing");
  } else if (stage === "queued") {
    mark(["uploading"], "done");
    mark(["queued"], "doing");
  } else if (stage === "processing") {
    mark(["uploading", "queued"], "done");
    mark(["analyzing", "removing", "finalizing"], "doing");
  } else if (stage === "completed") {
    mark(AI_CLEAN_PATH.map((p) => p.key), "done");
  }

  return state;
}

/**
 * Stage-based progress.
 *
 * The upload's fraction is REAL — the browser counts bytes it has sent, so this
 * is measurement, not decoration. Everything after it is a fixed value per
 * stage, which is the honest shape for work whose length we cannot see: it
 * moves when something actually happened and never creeps to look busy.
 */
function progressFor(stage: AiCleanStage, uploadFraction: number | null): number | null {
  switch (stage) {
    case "uploading":
      // The upload is a third of the visible journey, so a finished upload
      // reads as a third done rather than as nearly finished.
      return 0.05 + Math.max(0, Math.min(1, uploadFraction ?? 0)) * 0.28;
    case "queued":
      return 0.35;
    case "processing":
      return 0.6;
    case "completed":
      return 1;
    default:
      return null;
  }
}

export interface StageInput {
  /** The job as the server last described it. Null before one exists. */
  job: AiJobView | null;
  /** True while the browser is still sending the file. */
  uploading?: boolean;
  /** 0-1 from the upload's own progress events. */
  uploadFraction?: number | null;
}

const LABELS: Record<AiJobStatus, { label: string; detail: string | null }> = {
  queued: {
    label: "Queued",
    detail: "Waiting for a machine. This model runs on CPU, so it can take a few minutes to start.",
  },
  processing: {
    label: "Removing text",
    detail: "Frenz AI is finding the text and rebuilding what was behind it.",
  },
  completed: { label: "Ready", detail: null },
  failed: { label: "Didn't finish", detail: null },
  cancelled: { label: "Cancelled", detail: null },
  expired: { label: "No longer available", detail: "Cleaned videos are kept for three days." },
};

/** The whole display state, from the job and the upload. */
export function stageFor(input: StageInput): StageView {
  const { job, uploading, uploadFraction } = input;

  if (uploading) {
    return {
      stage: "uploading",
      label: "Uploading",
      detail: "Your video is going straight to private storage.",
      progress: progressFor("uploading", uploadFraction ?? 0),
      active: true,
    };
  }

  if (!job) {
    return { stage: "idle", label: "", detail: null, progress: null, active: false };
  }

  const copy = LABELS[job.status];
  const stage = job.status as AiCleanStage;
  return {
    stage,
    label: copy.label,
    // A failed job says what went wrong in the words the server chose, which is
    // already a written sentence rather than a provider's error.
    detail: job.status === "failed" ? (job.error?.message ?? null) : copy.detail,
    progress: progressFor(stage, null),
    active: job.status === "queued" || job.status === "processing",
  };
}

/**
 * How long to wait before asking again.
 *
 * ── Why it backs off ────────────────────────────────────────────────────────
 * A CPU video clean takes minutes. Polling every three seconds for ten minutes
 * is two hundred requests to learn one fact, on a phone, with the radio waking
 * each time — the battery rule this project holds every surface to. Fast at the
 * start (when a state change is genuinely imminent), slower once it is clear
 * this will take a while, and it never stops entirely so a finished job is
 * never missed.
 */
export function nextPollDelayMs(attempt: number): number {
  if (attempt < 4) return 3_000;
  if (attempt < 10) return 6_000;
  if (attempt < 30) return 12_000;
  return 20_000;
}
