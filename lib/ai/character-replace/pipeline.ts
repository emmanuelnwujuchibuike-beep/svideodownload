import type { CharacterReplaceLipSyncTier } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceVoiceSource } from "@/lib/ai/character-replace/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PIPELINE — which provider stages a job runs, in what order, and where it is
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 6 §9–§10 and §15: the job becomes
 *
 *     (text → TTS → audio validation) → character replacement → (lip sync) → final video
 *
 * and "Do not create invalid state transitions. LIPSYNC_PROCESSING →
 * CHARACTER_REPLACEMENT_PROCESSING should not be possible."
 *
 * ── 🔴 THE ROW'S `status` COLUMN IS UNCHANGED. THE STAGE LIVES INSIDE IT. ──
 *
 * `ai_jobs.status` keeps its five live values and its check constraint
 * (queued → acquiring → processing → finalizing → completed | failed), and
 * every safety net from Part 5 — the stall deadline, the provider reconcile,
 * the finalization lease, the refund-once — keeps working on those values
 * unchanged. A multi-stage job is `processing` for the whole provider
 * portion; WHICH provider stage it is on is this object, kept in the row's
 * metadata under `pipeline` and moved only by the transitions below.
 *
 * That is deliberate rather than lazy: adding six statuses to the column
 * would have meant re-teaching every sweep, every list, every `isActive`
 * check and the admin monitor what "live" means, for a distinction the
 * interface can draw from this object just as well (§21's stage list).
 * `stageView()` turns (status, pipeline) into the owner's named states.
 *
 * ── The stages ─────────────────────────────────────────────────────────────
 *
 *   voice     text-to-speech at the provider. Only when the voice is
 *             generated from text; runs FIRST so a dialogue that cannot fit
 *             the video fails before the expensive replacement is paid for.
 *   replace   the replacement itself — Face Only, Skin + Face or Full
 *             Character, one prediction, routed by mode.
 *   lipsync   the mouth matched to the new voice, on the REPLACED video
 *             (§10: never on the original).
 *   finalize  our worker: download, validate, store, settle, notify. Always.
 *
 * Between two provider stages the worker "advances" the job: it brings the
 * finished stage's output home (validated, stored in our bucket) and asks
 * the frontend to submit the next one. Nothing here talks to a provider;
 * this module only decides what comes next.
 */

export type PipelineStage = "voice" | "replace" | "lipsync" | "finalize";

export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = ["voice", "replace", "lipsync", "finalize"] as const;

export type StageStatus = "pending" | "submitted" | "processing" | "succeeded" | "failed";

export interface StageRecord {
  status: StageStatus;
  provider?: { id: "replicate"; model: string; version: string | null } | null;
  predictionId?: string | null;
  submittedAt?: string | null;
  finishedAt?: string | null;
  /** The provider's TEMPORARY output URL, recorded by the webhook; cleared once brought home. */
  outputUrl?: string | null;
  /** Where the worker stored this stage's output in OUR bucket, for the next stage. */
  storedPath?: string | null;
  error?: string | null;
}

export interface PipelineMeta {
  /** Decided ONCE at /start from the settings, never edited. Always ends with `finalize`. */
  stages: readonly PipelineStage[];
  /** The stage that is running, or is next to run. */
  current: PipelineStage;
  records: Partial<Record<PipelineStage, StageRecord>>;
  /** When the current provider stage was submitted — the clock a stall is measured from on a multi-stage job. */
  stage_started_at?: string | null;
  /**
   * Set by the webhook when a provider stage finished and the worker still
   * owes the hand-over to the next one; cleared by the worker when it has
   * stored the output and submitted the next stage. The recovery sweep
   * re-dispatches the advance while this is set.
   */
  pending_advance?: PipelineStage | null;
}

export interface PipelinePlanInput {
  mode: ReplacementMode;
  voiceMode: "original" | "new_voice";
  voiceSource: CharacterReplaceVoiceSource | null;
  lipSyncMode: CharacterReplaceLipSyncTier | null;
  /**
   * 2026-09-20: whether the text-to-speech provider answers with the audio
   * (ElevenLabs — the WORKER synthesises during prepare) rather than as a
   * prediction (MiniMax on Replicate — a `voice` stage). Decided by the
   * caller from the configured model (tts-provider.ts `ttsRunsInWorker`).
   * Absent = a prediction, which is what every plan before this date was.
   */
  ttsInWorker?: boolean;
}

/**
 * The stages this job will run, from what was priced. Pure and total: every
 * combination of settings yields a list, and the list always starts with
 * something a provider does and ends with `finalize`.
 */
export function planPipeline(input: PipelinePlanInput): PipelineMeta {
  const stages: PipelineStage[] = [];
  const newVoice = input.voiceMode === "new_voice";
  if (newVoice && input.voiceSource === "tts" && input.ttsInWorker !== true) stages.push("voice");
  stages.push("replace");
  if (newVoice && input.lipSyncMode) stages.push("lipsync");
  stages.push("finalize");
  const records: Partial<Record<PipelineStage, StageRecord>> = {};
  for (const s of stages) records[s] = { status: "pending" };
  return { stages, current: stages[0]!, records, stage_started_at: null, pending_advance: null };
}

/** The stage after `stage` in this job's plan, or null at the end. */
export function nextStage(pipeline: PipelineMeta, stage: PipelineStage): PipelineStage | null {
  const i = pipeline.stages.indexOf(stage);
  if (i < 0 || i + 1 >= pipeline.stages.length) return null;
  return pipeline.stages[i + 1]!;
}

/** Whether `stage` is a provider stage (something submitted to Replicate) rather than our own finalization. */
export function isProviderStage(stage: PipelineStage): stage is Exclude<PipelineStage, "finalize"> {
  return stage !== "finalize";
}

/** The last provider stage of the plan — the one whose output the finalizer stores. */
export function lastProviderStage(pipeline: PipelineMeta): Exclude<PipelineStage, "finalize"> {
  const providers = pipeline.stages.filter(isProviderStage);
  return providers[providers.length - 1] ?? "replace";
}

/**
 * The transition rule (§15): a job may only move from a stage to the stage
 * that follows it in ITS OWN plan, and only once the stage it is leaving has
 * succeeded. Backwards (lipsync → replace), skipping (voice → lipsync) and
 * re-entering a stage are all refused — the caller's compare-and-set on the
 * row is what makes the refusal hold under concurrency; this is the rule it
 * enforces.
 */
export function canAdvance(pipeline: PipelineMeta, from: PipelineStage, to: PipelineStage): boolean {
  if (pipeline.current !== from) return false;
  if (nextStage(pipeline, from) !== to) return false;
  return pipeline.records[from]?.status === "succeeded";
}

/** The plan with `stage` marked as having been handed to the provider. */
export function markSubmitted(
  pipeline: PipelineMeta,
  stage: PipelineStage,
  info: { predictionId: string; provider: { id: "replicate"; model: string; version: string | null }; at: string },
): PipelineMeta {
  return {
    ...pipeline,
    current: stage,
    stage_started_at: info.at,
    pending_advance: null,
    records: { ...pipeline.records, [stage]: { ...(pipeline.records[stage] ?? { status: "pending" }), status: "submitted", predictionId: info.predictionId, provider: info.provider, submittedAt: info.at, error: null } },
  };
}

export function markProcessing(pipeline: PipelineMeta, stage: PipelineStage): PipelineMeta {
  const record = pipeline.records[stage];
  if (!record || record.status !== "submitted") return pipeline;
  return { ...pipeline, records: { ...pipeline.records, [stage]: { ...record, status: "processing" } } };
}

/** The provider finished `stage`; its output is at `outputUrl` (temporary). The worker owes an advance unless the next stage is ours. */
export function markSucceeded(pipeline: PipelineMeta, stage: PipelineStage, outputUrl: string | null, at: string): PipelineMeta {
  const next = nextStage(pipeline, stage);
  return {
    ...pipeline,
    pending_advance: next && isProviderStage(next) ? stage : null,
    records: { ...pipeline.records, [stage]: { ...(pipeline.records[stage] ?? { status: "pending" }), status: "succeeded", outputUrl, finishedAt: at, error: null } },
  };
}

export function markFailed(pipeline: PipelineMeta, stage: PipelineStage, error: string, at: string): PipelineMeta {
  return {
    ...pipeline,
    pending_advance: null,
    records: { ...pipeline.records, [stage]: { ...(pipeline.records[stage] ?? { status: "pending" }), status: "failed", finishedAt: at, error: error.slice(0, 500) } },
  };
}

/** The worker brought `stage`'s output home at `storedPath` and the job now waits on `to`. Refuses an illegal move by returning null. */
export function advance(pipeline: PipelineMeta, from: PipelineStage, to: PipelineStage, storedPath: string | null, at: string = new Date().toISOString()): PipelineMeta | null {
  if (!canAdvance(pipeline, from, to)) return null;
  return {
    ...pipeline,
    current: to,
    pending_advance: null,
    // The clock the stall deadline and the sweep read is the CURRENT stage's. It
    // used to keep the previous stage's submit time across an advance, so a
    // throttled submit (Part 8, production) waited out the OLD stage's grace.
    stage_started_at: at,
    records: {
      ...pipeline.records,
      [from]: { ...(pipeline.records[from] ?? { status: "succeeded" }), storedPath, outputUrl: null },
    },
  };
}

/* ───────────────────────────── the owner's named states (§15, §21) ───────── */

/**
 * The state names from the brief, derived — never stored — from the row's
 * status, the ledger's refund state and the pipeline. One function, so the
 * processing screen, the history row and the admin monitor cannot disagree.
 */
export type CharacterReplaceStageName =
  | "READY"
  /** 0166: paid for, in the member's own line for a processing slot. */
  | "WAITING"
  | "VALIDATING"
  | "PREPARING"
  | "AUDIO_PREPARING"
  | "AUDIO_GENERATION_QUEUED"
  | "AUDIO_GENERATION_PROCESSING"
  | "AUDIO_READY"
  | "CHARACTER_REPLACEMENT_QUEUED"
  | "CHARACTER_REPLACEMENT_PROCESSING"
  | "CHARACTER_REPLACEMENT_COMPLETE"
  | "LIPSYNC_QUEUED"
  | "LIPSYNC_PROCESSING"
  | "LIPSYNC_COMPLETE"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "CANCELLED";

export function stageName(input: {
  status: "queued" | "waiting" | "acquiring" | "processing" | "finalizing" | "completed" | "failed" | "cancelled" | "expired" | "deleted";
  pipeline: PipelineMeta | null;
  /** From the ledger (Part 5 §29): whether a failed job's charge is still reserved or has come back. */
  refund: "none" | "settled" | "pending" | "refunded";
}): CharacterReplaceStageName {
  const { status, pipeline } = input;
  if (status === "completed") return "COMPLETED";
  if (status === "cancelled" || status === "deleted") return "CANCELLED";
  if (status === "failed" || status === "expired") return input.refund === "refunded" ? "REFUNDED" : input.refund === "pending" ? "REFUND_PENDING" : "FAILED";
  if (status === "queued") return "READY";
  if (status === "waiting") return "WAITING";
  if (status === "acquiring") return "PREPARING";
  if (status === "finalizing") return "FINALIZING";
  // processing: which provider stage, and how far
  const stage = pipeline?.current ?? "replace";
  const record = pipeline?.records[stage];
  const s = record?.status ?? "submitted";
  if (stage === "voice") return s === "succeeded" ? "AUDIO_READY" : s === "processing" ? "AUDIO_GENERATION_PROCESSING" : "AUDIO_GENERATION_QUEUED";
  if (stage === "lipsync") return s === "succeeded" ? "LIPSYNC_COMPLETE" : s === "processing" ? "LIPSYNC_PROCESSING" : "LIPSYNC_QUEUED";
  if (stage === "finalize") return "FINALIZING";
  return s === "succeeded" ? "CHARACTER_REPLACEMENT_COMPLETE" : s === "processing" ? "CHARACTER_REPLACEMENT_PROCESSING" : "CHARACTER_REPLACEMENT_QUEUED";
}

/**
 * The tracker rows for a job (§21): every stage of ITS plan, worded for the
 * mode, with done / doing / todo. No percentages — stage-based, as the
 * brief asks when provider progress is unavailable (it is).
 */
export interface StageStep {
  key: "prepare" | "voice" | "replace" | "lipsync" | "finalize";
  label: string;
  doneLabel: string;
  state: "done" | "doing" | "todo";
}

export function stageSteps(input: {
  status: "preparing" | "uploading" | "queued" | "waiting" | "processing" | "finalizing" | "complete" | "failed" | "refunded" | "cancelled" | "deleted";
  pipeline: PipelineMeta | null;
  mode: ReplacementMode;
}): StageStep[] {
  const stages = input.pipeline?.stages ?? ["replace", "finalize"];
  const replaceLabel = input.mode === "face_only" ? "Replacing the face" : input.mode === "skin_face" ? "Replacing the face and head" : input.mode === "upper_body" ? "Replacing the upper body" : "Replacing the character";
  const replaceDone = input.mode === "face_only" ? "Face replaced" : input.mode === "skin_face" ? "Face and head replaced" : input.mode === "upper_body" ? "Upper body replaced" : "Character replacement complete";
  const steps: StageStep[] = [{ key: "prepare", label: "Preparing your video", doneLabel: "Video prepared", state: "todo" }];
  for (const s of stages) {
    if (s === "voice") steps.push({ key: "voice", label: "Preparing voice", doneLabel: "Voice ready", state: "todo" });
    else if (s === "replace") steps.push({ key: "replace", label: replaceLabel, doneLabel: replaceDone, state: "todo" });
    else if (s === "lipsync") steps.push({ key: "lipsync", label: "Synchronizing speech", doneLabel: "Speech synchronized", state: "todo" });
    else steps.push({ key: "finalize", label: "Finalizing video", doneLabel: "Video finalized", state: "todo" });
  }
  const mark = (key: StageStep["key"], state: StageStep["state"]) => {
    const step = steps.find((x) => x.key === key);
    if (step) step.state = state;
  };
  const before = (key: StageStep["key"]) => {
    const i = steps.findIndex((x) => x.key === key);
    for (let j = 0; j < i; j++) steps[j]!.state = "done";
  };
  if (input.status === "preparing" || input.status === "uploading" || input.status === "queued") {
    mark("prepare", "doing");
  } else if (input.status === "waiting") {
    // 0166: nothing is being done yet — every step is still to come; the headline says why.
    /* all todo */
  } else if (input.status === "processing") {
    const current = input.pipeline?.current ?? "replace";
    const key: StageStep["key"] = current === "finalize" ? "finalize" : current;
    before(key);
    const record = input.pipeline?.records[current];
    mark(key, record?.status === "succeeded" ? "done" : "doing");
    if (record?.status === "succeeded") {
      // Between stages: the next step is what is being worked on.
      const i = steps.findIndex((x) => x.key === key);
      if (steps[i + 1]) steps[i + 1]!.state = "doing";
    }
  } else if (input.status === "finalizing") {
    before("finalize");
    mark("finalize", "doing");
  } else if (input.status === "complete") {
    for (const s of steps) s.state = "done";
  } else {
    // failed / refunded / cancelled: what had finished stays ticked; the rest is left as it was.
    const current = input.pipeline?.current;
    if (current) before(current === "finalize" ? "finalize" : current);
  }
  return steps;
}
