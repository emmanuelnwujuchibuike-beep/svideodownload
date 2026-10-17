import "server-only";

import { marketRate } from "@/lib/ai/character-replace/fx-rate-server";
import { getLandingSettings } from "@/lib/landing/settings";
import { commissionUsdCents, needsMarketRate, type CommissionAmount } from "@/lib/rewards/affiliate-fx";
import { pushRewards, type GrantedReward } from "@/lib/rewards/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The two Rewards v2 sweeps the 10-minute cron runs (0255). Both are bounded
 * and idempotent: the database pays each milestone and each commission at
 * most once, so a sweep beside a live trigger changes nothing twice. The push
 * goes after the commit and can never take a credit back.
 */

const MILESTONE_SWEEP_LIMIT = 50;
const COMMISSION_SWEEP_LIMIT = 50;

/** Members whose raw follower count passed a milestone they were not paid for. */
export async function sweepFollowerMilestones(): Promise<{ granted: number } | { error: string }> {
  const { data, error } = await createAdminClient().rpc("sweep_follower_milestones", { p_limit: MILESTONE_SWEEP_LIMIT });
  if (error) {
    console.error("[rewards/v2] follower milestone sweep failed", { message: error.message });
    return { error: error.message.slice(0, 160) };
  }
  const granted = (Array.isArray(data) ? data : []) as GrantedReward[];
  for (const g of granted) console.info("[rewards] granted", { event: g.event, role: g.role, beneficiary: g.beneficiary_id, amount: g.amount, class: g.credit_class, reward: g.reward_id });
  if (granted.length) await pushRewards(granted);
  return { granted: granted.length };
}

interface QueuedCommission extends CommissionAmount {
  reference: string;
  affiliate_id: string;
}

interface CommissionResult {
  ok: boolean;
  reward_id?: string;
  credits?: number;
  beneficiary_id?: string;
  duplicate?: boolean;
  skipped?: string;
  reason?: string;
}

/** Queued affiliate shares, oldest first: converted to USD, paid as withdrawable credits. */
export async function sweepAffiliateCommissions(): Promise<{ granted: number; skipped: number; waiting: number } | { error: string }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("affiliate_commissions")
    .select("reference, affiliate_id, amount_minor, currency, fx_minor_per_usd")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(COMMISSION_SWEEP_LIMIT);
  if (error) {
    console.error("[rewards/v2] affiliate commission read failed", { message: error.message });
    return { error: error.message.slice(0, 160) };
  }
  const rows = (data ?? []) as QueuedCommission[];
  if (!rows.length) return { granted: 0, skipped: 0, waiting: 0 };

  const creditsPerUsd = (await getLandingSettings()).frenzRewards.withdrawals.creditsPerUsd;
  // one market-rate lookup per currency per run, only for rows with no pinned rate
  const rates = new Map<string, number | null>();
  for (const cur of new Set(rows.filter(needsMarketRate).map((r) => r.currency.toUpperCase()))) {
    rates.set(cur, (await marketRate(cur).catch(() => null))?.rate.perUsd ?? null);
  }

  const pushes: GrantedReward[] = [];
  let skipped = 0;
  let waiting = 0;
  for (const row of rows) {
    const usdCents = commissionUsdCents(row, rates.get(row.currency.toUpperCase()) ?? null);
    if (usdCents === null) {
      waiting++;
      console.warn("[rewards/v2] no rate for an affiliate commission yet (stays queued)", { reference: row.reference, currency: row.currency });
      continue;
    }
    const { data: out, error: rpcError } = await db.rpc("grant_affiliate_commission", { p_reference: row.reference, p_usd_cents: usdCents, p_credits_per_usd: creditsPerUsd });
    if (rpcError) {
      waiting++;
      console.error("[rewards/v2] affiliate commission failed (stays queued)", { reference: row.reference, message: rpcError.message });
      continue;
    }
    const r = (out ?? {}) as CommissionResult;
    if (!r.ok) waiting++;
    if (r.skipped) skipped++;
    if (r.ok && r.reward_id && r.credits && r.beneficiary_id) {
      console.info("[rewards] granted", { event: "affiliate_commission", role: "referrer", beneficiary: r.beneficiary_id, amount: r.credits, class: "withdrawable", reward: r.reward_id });
      pushes.push({ reward_id: r.reward_id, beneficiary_id: r.beneficiary_id, role: "referrer", event: "affiliate_commission", amount: r.credits, credit_class: "withdrawable", balance_after: 0 });
    }
  }
  if (pushes.length) await pushRewards(pushes);
  return { granted: pushes.length, skipped, waiting };
}
