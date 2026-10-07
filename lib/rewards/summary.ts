import "server-only";

import { publicRewardsConfig, type RewardsConfig } from "@/lib/rewards/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What a member may see about their rewards (brief §10–§14): the one wallet
 * split into its classes, how far they are from withdrawal qualification, what
 * their links brought in, their recent rewards and withdrawals, and the
 * operator's public amounts. One parallel wave of bounded reads. Display only.
 */
export async function loadRewardsSummary(userId: string, config: RewardsConfig) {
  const db = createAdminClient();
  const [wallet, profile, user, links, referred, rewards, withdrawals, classTotals] = await Promise.all([
    db.from("ai_product_balances").select("balance_cents, withdrawable_cents, currency").eq("user_id", userId).eq("product", "character_replace").maybeSingle(),
    db.from("reward_profiles").select("qualified_at, qualifying_engagements, restricted").eq("user_id", userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
    db.from("share_links").select("clicks, signups").eq("owner_id", userId).limit(500),
    db.from("referral_attributions").select("referred_user_id", { count: "exact", head: false }).eq("referrer_id", userId).eq("status", "active").limit(1),
    db.from("reward_events").select("id, event_type, role, amount, credit_class, created_at").eq("beneficiary_id", userId).order("created_at", { ascending: false }).limit(10),
    db.from("withdrawal_requests").select("id, credits, amount_usd_cents, status, payout_method, created_at, completed_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    db.from("reward_events").select("amount, credit_class").eq("beneficiary_id", userId).limit(5000),
  ]);
  const w = (wallet.data ?? null) as { balance_cents: number; withdrawable_cents: number; currency: string } | null;
  const p = (profile.data ?? null) as { qualified_at: string | null; qualifying_engagements: number; restricted: boolean } | null;
  const createdAt = user.data.user?.created_at ?? null;
  const ageDays = createdAt ? Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000) : 0;
  const totals = ((classTotals.data ?? []) as { amount: number; credit_class: string }[]).reduce(
    (a, r) => {
      if (r.credit_class === "withdrawable") a.withdrawable += r.amount;
      else a.usable += r.amount;
      return a;
    },
    { usable: 0, withdrawable: 0 },
  );
  const linkRows = (links.data ?? []) as { clicks: number; signups: number }[];
  const balance = w?.currency === "CREDIT" ? Number(w.balance_cents) : 0;
  const withdrawable = w?.currency === "CREDIT" ? Number(w.withdrawable_cents ?? 0) : 0;
  return {
    wallet: { balanceCredits: balance, withdrawableCredits: withdrawable, usableCredits: Math.max(0, balance - withdrawable) },
    earned: totals,
    qualification: {
      qualified: !!p?.qualified_at,
      qualifiedAt: p?.qualified_at ?? null,
      restricted: !!p?.restricted,
      accountAgeDays: ageDays,
      requiredAccountAgeDays: config.qualification.minAccountAgeDays,
      engagements: p?.qualifying_engagements ?? 0,
      requiredEngagements: config.qualification.minEngagements,
    },
    referrals: { links: linkRows.length, clicks: linkRows.reduce((a, r) => a + r.clicks, 0), signups: linkRows.reduce((a, r) => a + r.signups, 0), referredMembers: referred.count ?? 0 },
    recentRewards: (rewards.data ?? []) as { id: string; event_type: string; role: string; amount: number; credit_class: string; created_at: string }[],
    withdrawals: (withdrawals.data ?? []) as { id: string; credits: number; amount_usd_cents: number; status: string; payout_method: string; created_at: string; completed_at: string | null }[],
    rules: publicRewardsConfig(config),
  };
}
export type RewardsSummary = Awaited<ReturnType<typeof loadRewardsSummary>>;
