import { isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";

/**
 * The operator's view of one Character Replace job and the glance summary
 * over a page of them — PURE (no server imports), because the job monitor
 * became a client component for its filter chips (0166 §17) and a client
 * file may not import lib/ai/admin-stats.ts (`server-only`). The rows are
 * shaped there, with the service role; this is only their type and their
 * arithmetic.
 */
/**
 * One row per recent Character Replace job, for the operator: status, the
 * provider's state as we recorded it, duration, quality, what was charged,
 * whether it came back, the prediction id, the timestamps. Read with the
 * service role, shaped here so the panel never sees a storage path.
 */
export interface CharacterReplaceAdminJob {
  id: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: AiJobStatus;
  userId: string | null;
  quality: string | null;
  durationMs: number | null;
  trimmed: boolean;
  chargedCents: number | null;
  currency: string | null;
  refunded: boolean;
  predictionId: string | null;
  modelVersion: string | null;
  errorCode: string | null;
  failureCategory: string | null;
  /* ── Part 5 (§35): the background's own bookkeeping ── */
  attempt: number;
  finalizeAttempts: number;
  finalizeNextAt: string | null;
  finalizeError: string | null;
  /** How long the worker's finalization took, when it finished. */
  finalizeMs: number | null;
  notifiedAt: string | null;
  notifyPending: boolean;
  /** Past the stage's deadline, or a finalization retry waiting with no lease. */
  stuck: boolean;
  /* ── Part 6: which replacement, which provider stage, what it cost us ── */
  mode: "face_only" | "skin_face" | "upper_body" | "full_character";
  /** The model of the CURRENT stage's prediction (`ai_jobs.model`). */
  model: string | null;
  /** "voice" | "replace" | "lipsync" | "finalize" — the pipeline's current stage, or null for a single-stage row. */
  stage: string | null;
  voiceSource: "upload" | "tts" | null;
  lipSyncMode: string | null;
  /** The operator's estimate of the provider bill, US cents. Null when no estimate was configured. */
  providerCostUsdCents: number | null;
  /** The quoted per-second customer rate, minor units. */
  rateCents: number | null;
  /* ── 0166 (multi-video): the session, the plan at start, the queue's own clocks ── */
  batchId: string | null;
  batchIndex: number | null;
  batchSize: number | null;
  /** The member's plan when they started ("admin" for an exempt administrator); null before 0166. */
  audience: string | null;
  /** Milliseconds spent waiting in the member's line before admission; null when it never waited. */
  waitedMs: number | null;
  /** The source name the member gave the file. */
  fileName: string | null;
  /** Whether the automatic refund was withheld by the operator's switch (an audit event, not a status). */
  billing: "FREE_TRIAL" | "PAID" | null;
}

/** The counts the operator wants at a glance (§35), from the rows already read. Pure. */
export function summarizeCharacterReplaceJobs(jobs: CharacterReplaceAdminJob[], now: number = Date.now()): {
  active: number;
  queued: number;
  /** 0166: paid for, in a member's line. */
  waiting: number;
  processing: number;
  finalizing: number;
  completed24h: number;
  failed24h: number;
  refunded24h: number;
  stuck: number;
  retrying: number;
} {
  const dayAgo = now - 24 * 60 * 60_000;
  const recent = (j: CharacterReplaceAdminJob) => Date.parse(j.completedAt ?? j.createdAt) >= dayAgo;
  return {
    active: jobs.filter((j) => isActiveStatus(j.status)).length,
    queued: jobs.filter((j) => j.status === "queued" || j.status === "acquiring").length,
    waiting: jobs.filter((j) => j.status === "waiting").length,
    processing: jobs.filter((j) => j.status === "processing").length,
    finalizing: jobs.filter((j) => j.status === "finalizing").length,
    completed24h: jobs.filter((j) => j.status === "completed" && recent(j)).length,
    failed24h: jobs.filter((j) => (j.status === "failed" || j.status === "expired") && recent(j)).length,
    refunded24h: jobs.filter((j) => j.refunded && recent(j)).length,
    stuck: jobs.filter((j) => j.stuck).length,
    retrying: jobs.filter((j) => j.status === "finalizing" && j.finalizeAttempts > 0 && !!j.finalizeNextAt).length,
  };
}
