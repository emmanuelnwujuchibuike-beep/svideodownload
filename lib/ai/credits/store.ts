import "server-only";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import type { CreditEstimate } from "@/lib/ai/credits/engine";
import { periodKeys, type PeriodKeys } from "@/lib/ai/credits/periods";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE CREDIT LEDGER — reserve, settle, release; the member's two clocks
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every function here is one SQL call to a `security definer` function that
 * only the service role may execute (0167). The reservation is the gate:
 * an advisory lock per member, both period sums taken inside it, both limits
 * checked, one row inserted — or the refusal named. Idempotent per job: a
 * replay answers the row it already made. Settle and release move a
 * RESERVED row exactly once; a settled row is never released.
 */

export type CreditReservation =
  | { ok: true; idempotent: boolean; credits: number; usedToday: number; usedThisWeek: number }
  | { ok: false; reason: "daily" | "weekly"; usedToday: number; usedThisWeek: number };

export function currentPeriods(config: AiPlansConfig, now: Date = new Date()): PeriodKeys {
  return periodKeys(now, config.reset.timezone, config.reset.weekStartsOn);
}

export async function reserveAiCredits(input: {
  userId: string;
  jobId: string;
  feature: string;
  plan: AiPlanId;
  estimate: CreditEstimate;
  dailyLimit: number;
  weeklyLimit: number;
  periods: PeriodKeys;
  config: AiPlansConfig;
}): Promise<CreditReservation> {
  const { data, error } = await createAdminClient().rpc("reserve_ai_credits", {
    p_user_id: input.userId,
    p_job_id: input.jobId,
    p_feature: input.feature,
    p_plan: input.plan,
    p_credits: input.estimate.creditsRequired,
    p_daily_limit: input.dailyLimit,
    p_weekly_limit: input.weeklyLimit,
    p_day_key: input.periods.dayKey,
    p_week_key: input.periods.weekKey,
    p_snapshot: { dailyLimit: input.dailyLimit, weeklyLimit: input.weeklyLimit, timezone: input.periods.timezone, weekStartsOn: input.periods.weekStartsOn, configVersion: input.config.version, centsPerCredit: input.estimate.centsPerCredit, priceCents: input.estimate.priceCents },
    p_breakdown: { lines: input.estimate.breakdown, mode: input.estimate.mode, quality: input.estimate.quality, durationMs: input.estimate.durationMs },
  });
  if (error) {
    console.error("[ai/credits] reserve failed", { userId: input.userId, jobId: input.jobId, code: error.code, message: error.message });
    throw new Error(error.message);
  }
  const r = (data ?? {}) as { ok?: boolean; idempotent?: boolean; credits?: number; reason?: string; day_used?: number; week_used?: number };
  if (r.ok) return { ok: true, idempotent: r.idempotent === true, credits: Number(r.credits ?? input.estimate.creditsRequired), usedToday: Number(r.day_used ?? 0), usedThisWeek: Number(r.week_used ?? 0) };
  return { ok: false, reason: r.reason === "weekly" ? "weekly" : "daily", usedToday: Number(r.day_used ?? 0), usedThisWeek: Number(r.week_used ?? 0) };
}

/** The job delivered: the reservation becomes consumption. True once, false on a replay or when nothing was reserved. */
export async function settleAiCredits(jobId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("settle_ai_credits", { p_job_id: jobId });
  if (error) {
    console.error("[ai/credits] settle failed", { jobId, code: error.code, message: error.message });
    return false;
  }
  return data === true;
}

/** The job ended without a result: the reservation comes back, once. A settled row never does. */
export async function releaseAiCredits(jobId: string, reason?: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("release_ai_credits", { p_job_id: jobId, p_reason: reason ?? null });
  if (error) {
    console.error("[ai/credits] release failed", { jobId, code: error.code, message: error.message });
    return false;
  }
  return data === true;
}

export interface AiCreditUsage {
  usedToday: number;
  usedThisWeek: number;
  periods: PeriodKeys;
}

export async function readAiCreditUsage(userId: string, config: AiPlansConfig, now: Date = new Date()): Promise<AiCreditUsage> {
  const periods = currentPeriods(config, now);
  const { data, error } = await createAdminClient().rpc("ai_credit_usage", { p_user_id: userId, p_day_key: periods.dayKey, p_week_key: periods.weekKey });
  if (error) {
    // before 0167 there is no ledger and nothing has been used
    if (error.code === "PGRST202" || /ai_credit_usage/.test(error.message)) return { usedToday: 0, usedThisWeek: 0, periods };
    console.error("[ai/credits] usage read failed", { userId, code: error.code, message: error.message });
    throw new Error(error.message);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { day_used?: number; week_used?: number } | undefined;
  return { usedToday: Number(row?.day_used ?? 0), usedThisWeek: Number(row?.week_used ?? 0), periods };
}

export type AiCreditLedgerStatus = "reserved" | "settled" | "released";

export interface AiCreditLedgerRow {
  id: number;
  user_id: string;
  job_id: string;
  feature: string;
  plan: AiPlanId;
  credits_reserved: number;
  credits_consumed: number;
  credits_refunded: number;
  status: AiCreditLedgerStatus;
  day_key: string;
  week_key: string;
  limits_snapshot: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

/** The ledger rows for a set of jobs (the result and history views; the admin monitor). Service role, so the caller scopes the ids. */
export async function creditLedgerFor(jobIds: readonly string[]): Promise<Map<string, AiCreditLedgerRow>> {
  const out = new Map<string, AiCreditLedgerRow>();
  if (!jobIds.length) return out;
  const { data, error } = await createAdminClient().from("ai_credit_ledger").select("*").in("job_id", [...jobIds]);
  if (error) return out;
  for (const row of (data ?? []) as AiCreditLedgerRow[]) out.set(row.job_id, row);
  return out;
}

/** The member's own recent credit transactions, newest first. */
export async function listOwnCreditLedger(userId: string, limit = 25): Promise<AiCreditLedgerRow[]> {
  const { data, error } = await createAdminClient().from("ai_credit_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(Math.max(1, Math.min(100, limit)));
  if (error) return [];
  return (data ?? []) as AiCreditLedgerRow[];
}

/** The most recent rows across members, for the admin usage monitor. */
export async function listCreditLedger(limit = 100): Promise<AiCreditLedgerRow[]> {
  const { data, error } = await createAdminClient().from("ai_credit_ledger").select("*").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(500, limit)));
  if (error) return [];
  return (data ?? []) as AiCreditLedgerRow[];
}
