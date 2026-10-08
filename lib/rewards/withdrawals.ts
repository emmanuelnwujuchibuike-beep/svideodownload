import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { withdrawalUsdCents, type RewardsConfig } from "@/lib/rewards/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WITHDRAWALS — only the cashable part of the wallet, paid out by an admin
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rewards brief §14 (2026-10-07; owner: payouts are MANUAL in v1). A member
 * asks; the database holds the credits at once (`request_withdrawal`: only
 * from `withdrawable_cents`, never usable, purchased or plan credits); an
 * admin reviews, pays outside the app, and marks it completed — or rejects it,
 * which returns the credits as withdrawable (`resolve_withdrawal`, once).
 * Nothing here says "paid" until an admin records the payout.
 */
export type WithdrawalStatus = "pending" | "reviewing" | "approved" | "processing" | "completed" | "rejected" | "cancelled";

export interface PayoutDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  country?: string;
}

export function validatePayoutDetails(method: string, raw: unknown): PayoutDetails | null {
  if (method !== "bank_transfer" || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const d = { accountName: s(r.accountName, 120), accountNumber: s(r.accountNumber, 40), bankName: s(r.bankName, 120), country: s(r.country, 2).toUpperCase() || undefined };
  if (d.accountName.length < 2 || !/^[0-9A-Za-z -]{4,40}$/.test(d.accountNumber) || d.bankName.length < 2) return null;
  return d;
}

export async function requestWithdrawal(input: { userId: string; credits: number; method: string; details: unknown; config: RewardsConfig }): Promise<{ ok: true; id: string; status: WithdrawalStatus; usdCents: number } | { ok: false; status: number; error: string }> {
  const w = input.config.withdrawals;
  if (!input.config.enabled || !w.enabled) return { ok: false, status: 503, error: "Withdrawals aren't open right now." };
  const credits = Math.floor(input.credits);
  if (!Number.isFinite(credits) || credits < w.minCredits || credits > w.maxCredits) return { ok: false, status: 400, error: `Withdraw between ${w.minCredits.toLocaleString("en-US")} and ${w.maxCredits.toLocaleString("en-US")} credits.` };
  if (!w.methods.includes(input.method)) return { ok: false, status: 400, error: "That payout method isn't available." };
  const details = validatePayoutDetails(input.method, input.details);
  if (!details) return { ok: false, status: 400, error: "Check your payout details." };

  const db = createAdminClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: recent } = await db.from("withdrawal_requests").select("credits, created_at, status").eq("user_id", input.userId).gte("created_at", monthAgo).limit(500);
  const live = ((recent ?? []) as { credits: number; created_at: string; status: string }[]).filter((r) => r.status !== "rejected" && r.status !== "cancelled");
  if (live.filter((r) => r.created_at >= dayAgo).length >= w.maxRequestsPerDay) return { ok: false, status: 429, error: "You've reached today's withdrawal limit." };
  if (live.reduce((a, r) => a + r.credits, 0) + credits > w.maxCreditsPerMonth) return { ok: false, status: 429, error: "That would pass this month's withdrawal limit." };

  const usdCents = withdrawalUsdCents(credits, w.creditsPerUsd);
  const status: WithdrawalStatus = credits > w.manualReviewAboveCredits ? "reviewing" : "pending";
  const { data, error } = await db.rpc("request_withdrawal", { p_user_id: input.userId, p_credits: credits, p_usd_cents: usdCents, p_method: input.method, p_details: details, p_snapshot: { creditsPerUsd: w.creditsPerUsd, version: input.config.version }, p_status: status });
  if (error) {
    console.error("[rewards/withdraw] request failed", { userId: input.userId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't submit that. Try again in a moment." };
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string; id?: string };
  if (!out.ok || !out.id) {
    const msg = out.reason === "insufficient_withdrawable" ? "You don't have that many withdrawable credits." : out.reason === "restricted" ? "Withdrawals are paused on this account. Contact support." : "Couldn't submit that.";
    return { ok: false, status: 409, error: msg };
  }
  console.info("[rewards/withdraw] requested", { userId: input.userId, id: out.id, credits, usdCents, status });
  return { ok: true, id: out.id, status, usdCents };
}

export async function resolveWithdrawal(input: { id: string; status: WithdrawalStatus; adminId: string; note?: string | null; payoutReference?: string | null }): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await createAdminClient().rpc("resolve_withdrawal", { p_id: input.id, p_status: input.status, p_admin: input.adminId, p_note: input.note ?? null, p_payout_ref: input.payoutReference ?? null });
  if (error) {
    console.error("[rewards/withdraw] resolve failed", { id: input.id, message: error.message });
    return { ok: false, reason: "error" };
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string };
  if (out.ok) {
    const { data: w } = await createAdminClient().from("withdrawal_requests").select("user_id, credits, amount_usd_cents").eq("id", input.id).maybeSingle();
    const row = w as { user_id: string; credits: number; amount_usd_cents: number } | null;
    if (row) {
      const body =
        input.status === "completed"
          ? `Your withdrawal of ${row.credits.toLocaleString("en-US")} credits was paid.`
          : input.status === "rejected" || input.status === "cancelled"
            ? `Your withdrawal was ${input.status}. The credits are back in your wallet.`
            : `Your withdrawal is ${input.status}.`;
      void sendSmartPush(row.user_id, { title: "Withdrawal update", body, url: "/studio/ai/usage", genericBody: "Your withdrawal was updated.", tag: `withdrawal-${input.id}` }, "medium", "premium", "already-recorded").catch(() => null);
      // 2026-10-07 (owner: "let users receive email")
      void emailMember(row.user_id, { subject: "Your withdrawal was updated", heading: "Withdrawal update", intro: body, ctaLabel: "View your rewards", ctaPath: "/rewards" });
    }
  }
  return { ok: !!out.ok, reason: out.reason };
}
