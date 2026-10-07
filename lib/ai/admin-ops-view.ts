import { isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI OPERATIONS — the pure half (Part 8 §7/§62, §35–§39; 2026-10-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The Overview tab's job table listed ONLY `ai_character_replace` — a retired
 * tool — and called every provider Replicate or fal. Every Kling video, Lip
 * Sync, Text to Audio and Voice Cloning job was invisible to the operator.
 * This turns ONE bounded read of every AI job (lib/ai/admin-ops.ts) into:
 *
 *   · the overview cards (§7/§62) — only figures the rows actually hold;
 *   · a job list for every tool (§35/§37);
 *   · failures split by WHOSE they are (§38): the provider's, FrenzSave's, or
 *     the member's input — a Kling outage and a finalizer bug are different
 *     problems with different owners;
 *   · repeated failures grouped (§39): 100 jobs with one Kling error = 1 row.
 *
 * Pure: no I/O, so every figure here is tested against fixtures.
 */

export interface OpsJobRow {
  id: string;
  user_id: string | null;
  feature: string;
  status: AiJobStatus;
  error_code: string | null;
  error_message: string | null;
  funding_source: string | null;
  provider: string | null;
  charged_cents: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  notified_at: string | null;
  replicate_prediction_id: string | null;
  finalize_error: string | null;
  /* selected JSON paths of `metadata` (never the whole blob: it holds prompts) */
  billing: string | null;
  units: string | number | null;
  category: string | null;
  notify_pending: string | boolean | null;
}

export type FailureOwner = "provider" | "frenzsave" | "member";

/** Codes a vendor produced or caused (a refused, failed, timed-out or unreachable generation). */
const PROVIDER_CODES = new Set(["PROVIDER_ERROR", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "POLICY_BLOCKED", "SUBMIT_FAILED", "INVALID_AI_OUTPUT", "LIPSYNC_FAILED", "VOICE_GENERATION_FAILED", "VOICE_CLONE_REJECTED"]);
/** Codes that are the member's input, not a fault anywhere. */
const MEMBER_CODES = new Set(["AUDIO_TOO_LONG", "AUDIO_TOO_SHORT", "AUDIO_INVALID", "INVALID_INPUT", "UNSUPPORTED_FORMAT", "UNSUPPORTED_SOURCE", "FILE_TOO_LARGE", "DURATION_MISMATCH"]);

export const isFailedStatus = (s: string): boolean => s === "failed" || s === "expired";

/** Whose failure this is (§38). The job's own recorded category wins; then the code; anything else is ours. */
export function failureOwner(code: string | null, category: string | null): FailureOwner {
  if (category === "provider") return "provider";
  if (category === "user") return "member";
  if (code && PROVIDER_CODES.has(code)) return "provider";
  if (code && MEMBER_CODES.has(code)) return "member";
  return "frenzsave";
}

/** The provider a job ran on, by name — never "auto" (§64). */
export function providerName(provider: string | null): string {
  switch (provider) {
    case "kling":
      return "Kling";
    case "elevenlabs":
      return "ElevenLabs";
    case "replicate":
      return "Replicate (retired)";
    case "fal":
      return "fal.ai (retired)";
    default:
      return "—";
  }
}

export type BillingKind = "free" | "credits" | "paid" | "unknown";

export function billingKind(row: Pick<OpsJobRow, "billing" | "funding_source">): BillingKind {
  if (row.billing === "FREE_TRIAL" || row.funding_source === "free") return "free";
  if (row.billing === "CREDITS" || row.funding_source === "credits") return "credits";
  if (row.billing === "PAID" || row.funding_source === "balance") return "paid";
  return "unknown";
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface OpsJob {
  id: string;
  userId: string | null;
  feature: string;
  provider: string;
  status: AiJobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Start → end, when both are known. */
  processingMs: number | null;
  billing: BillingKind;
  chargedCents: number | null;
  /** Kling units from the job's own quote — an ESTIMATE, from the measured matrix. */
  estimatedUnits: number | null;
  providerTaskId: string | null;
  failed: boolean;
  failure: { code: string; owner: FailureOwner; detail: string | null } | null;
  /** Finished but the member has not been told yet. */
  notifyPending: boolean;
}

export function toOpsJob(r: OpsJobRow): OpsJob {
  const failed = isFailedStatus(r.status);
  const start = r.started_at ? Date.parse(r.started_at) : NaN;
  const end = r.completed_at ? Date.parse(r.completed_at) : NaN;
  const detail = (r.finalize_error ?? r.error_message ?? "").trim();
  return {
    id: r.id,
    userId: r.user_id,
    feature: r.feature,
    provider: providerName(r.provider),
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    processingMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null,
    billing: billingKind(r),
    chargedCents: r.charged_cents,
    estimatedUnits: r.provider === "kling" ? num(r.units) : null,
    providerTaskId: r.replicate_prediction_id,
    failed,
    // an expired job with no code ran out of time with no outcome recorded — ours to explain
    failure: failed ? { code: r.error_code ?? (r.status === "expired" ? "EXPIRED_NO_OUTCOME" : "UNKNOWN"), owner: failureOwner(r.error_code, r.category), detail: detail ? detail.slice(0, 300) : null } : null,
    notifyPending: r.status === "completed" && !r.notified_at && (r.notify_pending === true || r.notify_pending === "true"),
  };
}

export interface OpsOverview {
  /** Jobs created since midnight UTC. */
  generationsToday: number;
  completedToday: number;
  failedToday: number;
  /** failed ÷ (completed + failed) today; null when nothing finished (never a fake 0 %). */
  failureRateToday: number | null;
  /** Wallet money taken by jobs that COMPLETED today, in the wallet currency's minor units. */
  walletRevenueTodayCents: number;
  freeToday: number;
  creditsToday: number;
  /** Estimated Kling units for Kling jobs completed today, and how many of them had an estimate. */
  klingUnitsToday: { units: number; jobs: number; withEstimate: number };
  activeInWindow: number;
}

function isToday(iso: string | null, dayStart: number): boolean {
  return !!iso && Date.parse(iso) >= dayStart;
}

export function startOfUtcDayMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function summarizeOps(jobs: readonly OpsJob[], now: number = Date.now()): OpsOverview {
  const day = startOfUtcDayMs(now);
  const doneToday = jobs.filter((j) => (j.status === "completed" || j.failed) && isToday(j.completedAt ?? j.createdAt, day));
  const completed = doneToday.filter((j) => j.status === "completed");
  const failed = doneToday.filter((j) => j.failed);
  const kling = completed.filter((j) => j.provider === "Kling");
  const withEstimate = kling.filter((j) => j.estimatedUnits !== null);
  return {
    generationsToday: jobs.filter((j) => isToday(j.createdAt, day)).length,
    completedToday: completed.length,
    failedToday: failed.length,
    failureRateToday: doneToday.length ? failed.length / doneToday.length : null,
    walletRevenueTodayCents: completed.filter((j) => j.billing === "paid").reduce((s, j) => s + (j.chargedCents ?? 0), 0),
    freeToday: completed.filter((j) => j.billing === "free").length,
    creditsToday: completed.filter((j) => j.billing === "credits").length,
    klingUnitsToday: { units: Math.round(withEstimate.reduce((s, j) => s + (j.estimatedUnits ?? 0), 0) * 10) / 10, jobs: kling.length, withEstimate: withEstimate.length },
    activeInWindow: jobs.filter((j) => isActiveStatus(j.status)).length,
  };
}

export interface ErrorGroup {
  code: string;
  feature: string;
  owner: FailureOwner;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** One example's detail, for the operator to recognise it. */
  example: string | null;
}

/** §39: repeated failures as ONE row each — by code and tool — most frequent first. */
export function groupFailures(jobs: readonly OpsJob[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const j of jobs) {
    if (!j.failure) continue;
    const at = j.completedAt ?? j.createdAt;
    const key = `${j.failure.code}|${j.feature}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { code: j.failure.code, feature: j.feature, owner: j.failure.owner, occurrences: 1, firstSeen: at, lastSeen: at, example: j.failure.detail });
    } else {
      g.occurrences += 1;
      if (at < g.firstSeen) g.firstSeen = at;
      if (at > g.lastSeen) {
        g.lastSeen = at;
        g.example = j.failure.detail ?? g.example;
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen));
}

export interface AiOperations {
  windowDays: number;
  /** The read hit its row cap: figures cover the most recent rows only, and the panel says so. */
  truncated: boolean;
  unreadable: boolean;
  overview: OpsOverview;
  jobs: OpsJob[];
  errorGroups: ErrorGroup[];
  /** Failures in the window by owner (§38). */
  failuresByOwner: Record<FailureOwner, number>;
}

export function buildAiOperations(rows: readonly OpsJobRow[], opts: { windowDays: number; cap: number; unreadable?: boolean; now?: number }): AiOperations {
  const jobs = rows.map(toOpsJob);
  const failuresByOwner: Record<FailureOwner, number> = { provider: 0, frenzsave: 0, member: 0 };
  for (const j of jobs) if (j.failure) failuresByOwner[j.failure.owner] += 1;
  return {
    windowDays: opts.windowDays,
    truncated: rows.length >= opts.cap,
    unreadable: !!opts.unreadable,
    overview: summarizeOps(jobs, opts.now),
    jobs,
    errorGroups: groupFailures(jobs),
    failuresByOwner,
  };
}
