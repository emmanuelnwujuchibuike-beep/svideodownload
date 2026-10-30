import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who may cash out AI credits (owner, 2026-10-30): "AI withdraw only works for affiliate system, users who apply and get
 * approval and they earn on every deposit their referral link brings … Withdrawal and AI earnings only shows to users
 * when they contact support and I turn it on."
 *
 * So the ONE gate for an AI-credit withdrawal is an APPROVED affiliate account (0255 affiliate_accounts, status
 * 'approved'), set by an admin (Admin → Rewards → Affiliates; app/api/admin/rewards/affiliates). Everyone else keeps
 * earning — quests, creation bonuses, deposits — as AI credits to spend on Frenz AI, never to withdraw. The reward
 * "qualification" application is closed (app/api/rewards/qualification). Exclusive (private post) money and Frenz Coin
 * are separate balances with their own withdrawals, untouched by this.
 *
 * Approving an affiliate also marks their reward profile approved, because the database's own withdrawal function
 * (0278 request_credit_withdrawal) still refuses a profile that isn't; it also makes their rewards from then on
 * withdrawable, as the owner asked ("unless they are approved for affiliate").
 */
export type AffiliateStatus = "none" | "pending" | "approved" | "declined" | "revoked";

export interface AffiliateState {
  status: AffiliateStatus;
  approved: boolean;
  /** this affiliate's share of an invitee's payment, in basis points (1000 = 10%) — null when not an affiliate */
  rateBp: number | null;
}

export const NOT_AFFILIATE: AffiliateState = { status: "none", approved: false, rateBp: null };

/** A member's affiliate standing. A failed read, or a database before 0255, is "not an affiliate" — the safe answer. */
export async function getAffiliateState(userId: string): Promise<AffiliateState> {
  try {
    const { data, error } = await createAdminClient().from("affiliate_accounts").select("status, rate_bp").eq("user_id", userId).maybeSingle();
    if (error || !data) return NOT_AFFILIATE;
    const status = (["pending", "approved", "declined", "revoked"].includes(data.status as string) ? data.status : "none") as AffiliateStatus;
    return { status, approved: status === "approved", rateBp: status === "approved" ? Number(data.rate_bp) : null };
  } catch {
    return NOT_AFFILIATE;
  }
}

/** The words a refused member sees — the affiliate route, through support. */
export const AFFILIATE_ONLY_MESSAGE = "Cashing out AI credits is for approved affiliates. Contact support to join the affiliate program.";
