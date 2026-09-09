import type { AiJobStatus, AiJobView, AiSourceKind } from "@/lib/ai/jobs";

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
 * ⚠️ UPDATED IN PART 4. "Finalizing" used to be one of two stages we could not
 * observe. It is now a REAL one: the audio mux runs in our own worker and the
 * row says `finalizing` while it does, so the step is announced because it is
 * genuinely happening — not because a timer decided it ought to be.
 *
 * "Analyzing video" is still not a separate signal. The model does detection
 * and inpainting inside one Replicate prediction reporting a single
 * `processing` state, so announcing it as the current step would mean deciding
 * by a timer that analysis "must be done by now" — the same lie as a
 * self-incrementing percentage, wearing a different label. It appears in the
 * PATH, so the member sees the whole journey, and lights up together with
 * "Removing text" rather than before it. Subscribing to Replicate's log stream
 * is what would make it real, and this file is where it would turn on.
 */

export type AiCleanStage =
  | "idle"
  | "uploading"
  /** Our worker is fetching a pasted link (Part 6). Not the same as uploading. */
  | "acquiring"
  | "queued"
  | "processing"
  | "finalizing"
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
 * The same journey, worded for how the video actually arrived (Part 6).
 *
 * 🔴 ONE step differs and only its LABEL does. The keys are identical, so
 * `pathState` stays a pure function of the stage and nothing downstream has to
 * learn about source kinds. "Uploading" is simply the wrong word for a link —
 * the member sent nothing from their device — and a tracker that says it while
 * our server downloads from TikTok is describing work that is not happening.
 */
export function aiCleanPath(sourceKind: AiSourceKind): readonly { key: string; label: string }[] {
  if (sourceKind !== "url") return AI_CLEAN_PATH;
  return AI_CLEAN_PATH.map((step) =>
    step.key === "uploading" ? { key: step.key, label: "Getting your video" } : step,
  );
}

/**
 * Which path steps are done, doing, and to come.
 *
 * 🔴 `analyzing` is never returned as the current step on its own — see the
 * note at the top. While the job is processing it reads as "doing" together
 * with `removing`, because both are underway inside one prediction and
 * pretending to know which would be the fabrication.
 *
 * `finalizing` IS its own step as of Part 4: the audio mux runs in our worker
 * and the row says so while it does.
 */
export function pathState(stage: AiCleanStage): Record<string, "done" | "doing" | "todo"> {
  const state: Record<string, "done" | "doing" | "todo"> = {};
  const mark = (keys: string[], value: "done" | "doing" | "todo") => {
    for (const k of keys) state[k] = value;
  };

  mark(AI_CLEAN_PATH.map((p) => p.key), "todo");

  if (stage === "uploading" || stage === "acquiring") {
    // The same slot: "your video is arriving". Which of the two words the
    // tracker prints is `aiCleanPath`'s job, not this one's.
    mark(["uploading"], "doing");
  } else if (stage === "queued") {
    mark(["uploading"], "done");
    mark(["queued"], "doing");
  } else if (stage === "processing") {
    mark(["uploading", "queued"], "done");
    // Two steps, one signal — see the note at the top.
    mark(["analyzing", "removing"], "doing");
  } else if (stage === "finalizing") {
    // Real, and therefore its own step: the AI is finished and our worker is
    // putting the original sound back on.
    mark(["uploading", "queued", "analyzing", "removing"], "done");
    mark(["finalizing"], "doing");
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
/**
 * How far a stage may drift toward the next one while it waits.
 *
 * ── 🔴 THIS MOVES, AND IT STILL DOES NOT LIE ────────────────────────────────
 *
 * Owner, 2026-09-08: "the progress shouldnt delay at 60% while removing text,
 * it should be moving a little untill it completes so users dont think it got
 * stuck."
 *
 * They are right about the problem. A bar frozen on 60% for a minute and a half
 * reads as a hung page, and this feature has spent a long time looking hung.
 *
 * The standing rule here is that nothing invents progress it cannot observe,
 * and that rule is kept. What this adds is an ESTIMATE, held to two promises
 * that make it honest:
 *
 *   1. it is ASYMPTOTIC — each stage approaches the next stage's floor and can
 *      never arrive. Sixty percent creeps toward eighty-four and stops short,
 *      so the bar can never claim a step that has not happened;
 *   2. only a real event moves it past a floor, and only genuine completion
 *      reaches 100%.
 *
 * The curve also decelerates, which is the honest shape: fast early movement
 * says "this started", and visible slowing says "still working" rather than
 * "about to finish". A linear creep would promise a finish time we do not know.
 *
 * ⚠️ It costs nothing to run. The value is recomputed on the polls the page is
 * already making, so there is no timer, no extra render loop, and no battery
 * cost on a screen somebody leaves open — which is a rule this feature has
 * already broken twice today.
 */
function creepToward(floor: number, ceiling: number, elapsedMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return floor;
  // 1 - e^(-t/τ): approaches 1 without reaching it, fast at first, then slower.
  const progressed = 1 - Math.exp(-elapsedMs / halfLifeMs);
  return floor + (ceiling - floor) * progressed;
}

function progressFor(
  stage: AiCleanStage,
  uploadFraction: number | null,
  /** How long the CURRENT stage has been running. Null when unknown. */
  elapsedMs: number | null,
): number | null {
  switch (stage) {
    case "uploading":
      // The upload is a third of the visible journey, so a finished upload
      // reads as a third done rather than as nearly finished. This one is a
      // real measurement — bytes the browser has actually sent — so it never
      // creeps.
      return 0.05 + Math.max(0, Math.min(1, uploadFraction ?? 0)) * 0.28;
    case "acquiring":
      /*
        The same band the upload occupies, because it is the same part of the
        journey — the video arriving. It CREEPS rather than measuring, and that
        is the honest difference: an upload counts bytes the browser has sent,
        while a download happening on our worker reports nothing back until it
        is finished. A 30-second half-life suits a short clip off a CDN.
      */
      return creepToward(0.05, 0.33, elapsedMs ?? 0, 30_000);
    case "queued":
      // Toward `processing`'s floor. Queue time at the provider was measured at
      // ~19s, so this reaches most of the way there in about half a minute.
      return creepToward(0.35, 0.58, elapsedMs ?? 0, 25_000);
    case "processing":
      /*
        The long one, and the one the owner watched sit still. A whole job was
        measured end to end at 99 seconds, so the half-life is set near that:
        the bar is still visibly moving a minute in, and still short of 84%.
      */
      return creepToward(0.6, 0.84, elapsedMs ?? 0, 45_000);
    case "finalizing":
      // Past the long part. The mux is seconds of work against minutes of AI,
      // so this creeps quickly — and still never reaches 1.
      return creepToward(0.85, 0.98, elapsedMs ?? 0, 12_000);
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
  /**
   * Injected clock, so the creeping progress stays a PURE function.
   *
   * Defaults to `Date.now()`. Tests pass a fixed value and assert the curve
   * without waiting for real seconds to pass.
   */
  now?: number;
}

const LABELS: Record<AiJobStatus, { label: string; detail: string | null }> = {
  /*
    ── 🔴 NEVER NAME THE HARDWARE ──────────────────────────────────────────

    Owner, 2026-09-09: "it says running on cpu, i thought is gpu... users feel
    less of the app when they see running on cpu."

    They are right, and it was worse than a tone problem: "this model runs on
    CPU, so it can take a few minutes to start" is an implementation detail
    leaking into a member's screen, it reads as an apology, and it is no longer
    even accurate — the detector's measured predict time is ~6 seconds.

    What a person waiting needs to know is that the work is real and that they
    may leave. Which silicon it runs on is ours to worry about.
  */
  queued: {
    label: "Queued",
    detail: "Your video is in line. This usually starts within a few seconds.",
  },
  /*
    🔴 SAID IN THE MEMBER'S TERMS, AND HONESTLY.

    "Getting your video" is what is happening: our worker is downloading it from
    the link they pasted. Not "uploading" (they sent nothing), not "removing
    text" (nothing has been asked to do that yet). Part 3's rule about never
    rendering a step that is not the current step applies here too — the reason
    `acquiring` is a real status rather than a flag on `processing`.
  */
  acquiring: {
    label: "Getting your video",
    detail: "Fetching it from the link you pasted. Nothing is sent from your device.",
  },
  processing: {
    label: "Removing text",
    detail: "Frenz AI is finding the text and rebuilding what was behind it.",
  },
  finalizing: {
    label: "Restoring your audio",
    // Said in the member's terms. "Muxing an AAC track with stream copy" is
    // true and is not for them.
    detail: "Putting the original sound back on your cleaned video.",
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
      progress: progressFor("uploading", uploadFraction ?? 0, null),
      active: true,
    };
  }

  if (!job) {
    return { stage: "idle", label: "", detail: null, progress: null, active: false };
  }

  const copy = LABELS[job.status];
  const stage = job.status as AiCleanStage;

  /*
    How long this stage has been running, for the creep above.

    `startedAt` is when the provider was engaged and is the right clock for
    `processing`; before that there is only `createdAt`. `now` is injected so
    the whole thing stays a pure function and can be tested without a clock.
  */
  const since = Date.parse(
    (stage === "queued" ? job.createdAt : (job.startedAt ?? job.createdAt)) ?? "",
  );
  const elapsedMs = Number.isFinite(since) ? (input.now ?? Date.now()) - since : null;

  return {
    stage,
    label: copy.label,
    // A failed job says what went wrong in the words the server chose, which is
    // already a written sentence rather than a provider's error.
    detail: job.status === "failed" ? (job.error?.message ?? null) : copy.detail,
    progress: progressFor(stage, null, elapsedMs),
    active: job.status === "queued" || job.status === "processing" || job.status === "finalizing",
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
