import "server-only";

import type { AiPlanId, AiPlansConfig } from "@/lib/ai/credits/config";
import { listCreditLedger, type AiCreditLedgerRow } from "@/lib/ai/credits/store";
import { listAiSubscriptions, subscriptionIsActive } from "@/lib/ai/credits/subscription";
import type { AiJobStatus } from "@/lib/ai/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The operator's view of the AI plans (0167): who is on what, what the
 * credits are being spent on, what came back — read with the service role
 * and shaped here so the panel never sees a provider reference. Provider
 * costs stay where they are (the operator's estimate on the job row).
 */

export interface AiCreditMonitorRow {
  id: number;
  at: string;
  userId: string;
  jobId: string;
  feature: string;
  plan: AiPlanId;
  sitePlan: string | null;
  creditsRequired: number;
  creditsConsumed: number;
  creditsRefunded: number;
  ledgerStatus: "reserved" | "settled" | "released";
  jobStatus: AiJobStatus | null;
  mode: string | null;
  quality: string | null;
  durationMs: number | null;
  dayKey: string;
  weekKey: string;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  configVersion: number | null;
  subscriptionStatus: string | null;
  reason: string | null;
}

export interface AiPlansAdminStats {
  subscribers: { ai_pro: number; ai_max: number; active: number; canceled: number; pastDue: number };
  credits7d: { reserved: number; consumed: number; refunded: number; generations: number; averagePerGeneration: number };
  topModes: { mode: string; count: number; credits: number }[];
  topQualities: { quality: string; count: number; credits: number }[];
  /** Members who used a complimentary creation and later took an AI plan. */
  freeToPlan: number;
  /** Members whose AI plan went from AI Pro to AI Max (from the events table). */
  proToMax: number;
  revenueCents: { ai_pro: number; ai_max: number; currency: string };
}

export async function listAiCreditMonitor(limit = 120): Promise<AiCreditMonitorRow[]> {
  const rows = await listCreditLedger(limit);
  if (!rows.length) return [];
  const db = createAdminClient();
  const jobIds = rows.map((r) => r.job_id);
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [jobsRes, subsRes, siteRes] = await Promise.all([
    db.from("ai_jobs").select("id, status, metadata").in("id", jobIds),
    db.from("ai_subscriptions").select("user_id, plan, status, current_period_end").in("user_id", userIds),
    db.from("subscriptions").select("user_id, plan, status").in("user_id", userIds),
  ]);
  const jobs = new Map<string, { status: AiJobStatus; metadata: Record<string, unknown> | null }>();
  for (const j of (jobsRes.data ?? []) as { id: string; status: AiJobStatus; metadata: Record<string, unknown> | null }[]) jobs.set(j.id, j);
  const subs = new Map<string, { plan: string; status: string }>();
  for (const s of (subsRes.data ?? []) as { user_id: string; plan: string; status: string }[]) subs.set(s.user_id, s);
  const site = new Map<string, string>();
  for (const s of (siteRes.data ?? []) as { user_id: string; plan: string; status: string }[]) if (s.status === "active" || s.status === "trialing") site.set(s.user_id, s.plan);
  return rows.map((r: AiCreditLedgerRow) => {
    const job = jobs.get(r.job_id);
    const m = job?.metadata ?? {};
    const settings = (m.settings ?? {}) as { quality?: unknown };
    const breakdown = (r.breakdown ?? {}) as { mode?: unknown; quality?: unknown; durationMs?: unknown };
    const snap = (r.limits_snapshot ?? {}) as { dailyLimit?: unknown; weeklyLimit?: unknown; configVersion?: unknown };
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      id: r.id,
      at: r.created_at,
      userId: r.user_id,
      jobId: r.job_id,
      feature: r.feature,
      plan: r.plan,
      sitePlan: site.get(r.user_id) ?? "free",
      creditsRequired: r.credits_reserved,
      creditsConsumed: r.credits_consumed,
      creditsRefunded: r.credits_refunded,
      ledgerStatus: r.status,
      jobStatus: job?.status ?? null,
      mode: typeof breakdown.mode === "string" ? breakdown.mode : typeof m.mode === "string" ? m.mode : null,
      quality: typeof breakdown.quality === "string" ? breakdown.quality : typeof settings.quality === "string" ? settings.quality : null,
      durationMs: num(breakdown.durationMs),
      dayKey: r.day_key,
      weekKey: r.week_key,
      dailyLimit: num(snap.dailyLimit),
      weeklyLimit: num(snap.weeklyLimit),
      configVersion: num(snap.configVersion),
      subscriptionStatus: subs.get(r.user_id)?.status ?? null,
      reason: r.reason,
    };
  });
}

export async function getAiPlansAdminStats(config: AiPlansConfig, currency: string): Promise<AiPlansAdminStats> {
  const db = createAdminClient();
  const now = Date.now();
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [subs, ledger7d, freeUsers, events] = await Promise.all([
    listAiSubscriptions(1000),
    db.from("ai_credit_ledger").select("credits_reserved, credits_consumed, credits_refunded, status, breakdown").gte("created_at", since).limit(5000),
    db.from("ai_free_uses").select("user_id").limit(5000),
    db.from("events").select("user_id, metadata").eq("type", "subscribe").gte("created_at", new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()).limit(5000),
  ]);
  const subscribers = { ai_pro: 0, ai_max: 0, active: 0, canceled: 0, pastDue: 0 };
  const revenueCents = { ai_pro: 0, ai_max: 0, currency };
  for (const s of subs) {
    const active = subscriptionIsActive(s, now);
    if (active) {
      subscribers[s.plan] += 1;
      subscribers.active += 1;
      revenueCents[s.plan] += config.plans[s.plan].priceCents;
    }
    if (s.status === "canceled") subscribers.canceled += 1;
    if (s.status === "past_due") subscribers.pastDue += 1;
  }
  const rows = (ledger7d.data ?? []) as { credits_reserved: number; credits_consumed: number; credits_refunded: number; status: string; breakdown: { mode?: unknown; quality?: unknown } | null }[];
  const modes = new Map<string, { count: number; credits: number }>();
  const qualities = new Map<string, { count: number; credits: number }>();
  let reserved = 0;
  let consumed = 0;
  let refunded = 0;
  for (const r of rows) {
    reserved += r.credits_reserved;
    consumed += r.credits_consumed;
    refunded += r.credits_refunded;
    const mode = typeof r.breakdown?.mode === "string" ? r.breakdown.mode : "unknown";
    const quality = typeof r.breakdown?.quality === "string" ? r.breakdown.quality : "unknown";
    const mm = modes.get(mode) ?? { count: 0, credits: 0 };
    modes.set(mode, { count: mm.count + 1, credits: mm.credits + r.credits_reserved });
    const qq = qualities.get(quality) ?? { count: 0, credits: 0 };
    qualities.set(quality, { count: qq.count + 1, credits: qq.credits + r.credits_reserved });
  }
  const top = (m: Map<string, { count: number; credits: number }>, key: "mode" | "quality") =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([k, v]) => ({ [key]: k, count: v.count, credits: v.credits }) as never);
  const freeSet = new Set(((freeUsers.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const planHolders = new Set(subs.map((s) => s.user_id));
  let freeToPlan = 0;
  for (const u of freeSet) if (planHolders.has(u)) freeToPlan += 1;
  // pro → max: a member with both an ai_pro and a later ai_max subscribe event
  const byUser = new Map<string, Set<string>>();
  for (const e of (events.data ?? []) as { user_id: string | null; metadata: { plan?: unknown; kind?: unknown } | null }[]) {
    if (!e.user_id || e.metadata?.kind !== "ai_plan" || typeof e.metadata?.plan !== "string") continue;
    const set = byUser.get(e.user_id) ?? new Set<string>();
    set.add(e.metadata.plan);
    byUser.set(e.user_id, set);
  }
  let proToMax = 0;
  for (const set of byUser.values()) if (set.has("ai_pro") && set.has("ai_max")) proToMax += 1;
  return {
    subscribers,
    credits7d: { reserved, consumed, refunded, generations: rows.length, averagePerGeneration: rows.length ? Math.round((reserved / rows.length) * 10) / 10 : 0 },
    topModes: top(modes, "mode"),
    topQualities: top(qualities, "quality"),
    freeToPlan,
    proToMax,
    revenueCents,
  };
}
