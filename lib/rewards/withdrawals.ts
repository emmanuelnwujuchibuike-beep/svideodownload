import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { splitWithdrawalUsdCents, withdrawalFlatFeeCents, withdrawalUsdCents, type RewardsConfig } from "@/lib/rewards/config";
import { createAdminClient } from "@/lib/supabase/admin";

import { resolveAccount } from "./paystack-banks";

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
export type WithdrawalStatus = "pending" | "reviewing" | "approved" | "processing" | "completed" | "rejected" | "cancelled" | "reversed";

export interface PayoutDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  country?: string;
  /** "paystack" payouts (owner 2026-10-11): the Paystack bank code; the name is resolved by Paystack, never typed */
  bankCode?: string;
  /** "international" (owner 2026-10-12, paid by hand): how — a bank wire or PayPal */
  rail?: "bank" | "paypal";
  /** a bank's SWIFT / BIC, for an international wire */
  swift?: string;
  /** the PayPal account's email */
  email?: string;
}

/**
 * International payouts (owner 2026-10-12: "payout should not only go to Nigerian accounts").
 * A Nigerian Paystack business can only pay Nigerian banks — Paystack does not transfer across
 * currencies — so a creator outside Nigeria saves a bank wire or a PayPal account and the
 * withdrawal waits in the admin queue to be paid BY HAND ("Mark paid" there). Nigeria itself
 * is refused here: Nigerian banks are paid instantly through Paystack instead.
 */
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;
function validateInternational(r: Record<string, unknown>, s: (v: unknown, max: number) => string): PayoutDetails | null {
  // exactly a two-letter ISO code: "Ghana" must not be cut to "GH" (a cut name could name another country)
  const country = s(r.country, 8).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === "NG") return null;
  const accountName = s(r.accountName, 120);
  if (accountName.length < 2) return null;
  if (r.rail === "paypal") {
    const email = s(r.email, 254).toLowerCase();
    return EMAIL.test(email) ? { accountName, accountNumber: "", bankName: "PayPal", country, rail: "paypal", email } : null;
  }
  const bankName = s(r.bankName, 120);
  const accountNumber = s(r.accountNumber, 40).replace(/\s+/g, " ");
  const swift = s(r.swift, 11).toUpperCase().replace(/\s+/g, "");
  if (bankName.length < 2 || !/^[0-9A-Za-z -]{4,40}$/.test(accountNumber) || !SWIFT.test(swift)) return null;
  return { accountName, accountNumber, bankName, country, rail: "bank", swift };
}

export function validatePayoutDetails(method: string, raw: unknown): PayoutDetails | null {
  if ((method !== "bank_transfer" && method !== "paystack" && method !== "international") || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (method === "international") return validateInternational(r, s);
  if (method === "paystack") {
    // a Nigerian NUBAN and a Paystack bank code; the account name is filled from Paystack in requestWithdrawal
    const p = { accountName: "", accountNumber: s(r.accountNumber, 10), bankName: s(r.bankName, 120), bankCode: s(r.bankCode, 10), country: "NG" };
    return /^\d{10}$/.test(p.accountNumber) && /^[0-9A-Za-z]{2,10}$/.test(p.bankCode) && p.bankName.length >= 2 ? p : null;
  }
  const d = { accountName: s(r.accountName, 120), accountNumber: s(r.accountNumber, 40), bankName: s(r.bankName, 120), country: s(r.country, 2).toUpperCase() || undefined };
  if (d.accountName.length < 2 || !/^[0-9A-Za-z -]{4,40}$/.test(d.accountNumber) || d.bankName.length < 2) return null;
  return d;
}

/** The database's refusals, in the member's words (0278 adds the eligibility and limit reasons). */
const REFUSED: Record<string, [number, string]> = {
  restricted: [403, "Withdrawals are paused on this account. Contact support."],
  suspended: [403, "Withdrawals are paused on this account. Contact support."],
  recovery_due: [403, "Withdrawals are paused while a refunded payment is settled. Contact support."],
  not_qualified: [403, "Your account isn't approved for withdrawals yet."],
  day_limit: [429, "You've reached today's withdrawal limit."],
  month_limit: [429, "That would pass this month's withdrawal limit."],
  open_exists: [409, "You already have a withdrawal in progress."],
};

const MISSING_FN = (m: string) => /request_credit_withdrawal|schema cache|does not exist/i.test(m);

/**
 * Part 2 (0278, M1/M2): the facts the database re-checks under the wallet lock, read here too so a refusal is
 * immediate and worded. Fails CLOSED — an unreadable profile is not an eligible one.
 */
async function withdrawalEligibility(userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const db = createAdminClient();
  const [who, prof] = await Promise.all([
    db.from("profiles").select("is_suspended").eq("id", userId).maybeSingle(),
    db.from("reward_profiles").select("qualified_at, qualification_status, restricted").eq("user_id", userId).maybeSingle(),
  ]);
  if (who.error || prof.error || !who.data) return { ok: false, status: 503, error: "Couldn't submit that. Try again in a moment." };
  if ((who.data as { is_suspended?: boolean }).is_suspended) return { ok: false, status: 403, error: REFUSED.suspended![1] };
  const p = prof.data as { qualified_at: string | null; qualification_status: string | null; restricted: boolean } | null;
  if (p?.restricted) return { ok: false, status: 403, error: REFUSED.restricted![1] };
  // the rewards page's rule (features/rewards/rewards-page.tsx): approved = qualified_at set OR status approved
  if (!p || !(p.qualified_at || p.qualification_status === "approved")) return { ok: false, status: 403, error: REFUSED.not_qualified![1] };
  return { ok: true };
}

export async function requestWithdrawal(input: { userId: string; credits: number; method: string; details: unknown; config: RewardsConfig; idempotencyKey?: string | null }): Promise<{ ok: true; id: string; status: WithdrawalStatus; usdCents: number } | { ok: false; status: number; error: string }> {
  const w = input.config.withdrawals;
  if (!input.config.enabled || !w.enabled) return { ok: false, status: 503, error: "Withdrawals aren't open right now." };
  const credits = Math.floor(input.credits);
  if (!Number.isFinite(credits) || credits < w.minCredits || credits > w.maxCredits) return { ok: false, status: 400, error: `Withdraw between ${w.minCredits.toLocaleString("en-US")} and ${w.maxCredits.toLocaleString("en-US")} credits.` };
  if (!w.methods.includes(input.method)) return { ok: false, status: 400, error: "That payout method isn't available." };
  const details = validatePayoutDetails(input.method, input.details);
  if (!details) return { ok: false, status: 400, error: "Check your payout details." };
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) return { ok: false, status: 400, error: "Invalid request." };
  const eligible = await withdrawalEligibility(input.userId);
  if (!eligible.ok) return eligible;
  if (input.method === "paystack") {
    // the money goes where Paystack says the account is: the holder name comes from the bank, not from the form
    const name = await resolveAccount(details.accountNumber, details.bankCode ?? "");
    if (!name) return { ok: false, status: 400, error: "That account number doesn't match the bank. Check both." };
    details.accountName = name;
  }

  const db = createAdminClient();
  // early, worded answers only: 0278's request_credit_withdrawal re-counts both limits under the wallet lock
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: recent } = await db.from("withdrawal_requests").select("credits, created_at, status").eq("user_id", input.userId).eq("source", "credits").gte("created_at", monthAgo).limit(500);
  const live = ((recent ?? []) as { credits: number; created_at: string; status: string }[]).filter((r) => r.status !== "rejected" && r.status !== "cancelled");
  if (live.filter((r) => r.created_at >= dayAgo).length >= w.maxRequestsPerDay) return { ok: false, status: 429, error: "You've reached today's withdrawal limit." };
  if (live.reduce((a, r) => a + r.credits, 0) + credits > w.maxCreditsPerMonth) return { ok: false, status: 429, error: "That would pass this month's withdrawal limit." };

  // 0202: the part that came from a deposit is paid at its own rate, less its own fee
  const { data: bal } = await db.from("ai_product_balances").select("withdrawable_cents, deposited_cents").eq("user_id", input.userId).eq("product", "character_replace").maybeSingle();
  const b = bal as { withdrawable_cents?: number | null; deposited_cents?: number | null } | null;
  const split = b && Number(b.deposited_cents ?? 0) > 0 ? splitWithdrawalUsdCents(credits, Number(b.withdrawable_cents ?? 0), Number(b.deposited_cents ?? 0), w) : null;
  const usdCents = split ? split.usdCents : withdrawalUsdCents(credits, w.creditsPerUsd);
  const status: WithdrawalStatus = credits > w.manualReviewAboveCredits ? "reviewing" : "pending";
  /*
    The flat withdrawal fee (owner 2026-10-17: "for every withdraw"), the same tiers as private-post
    money (sub.flatFees), by the withdrawal's USD value. It comes ON TOP: its credits (rounded UP) are
    reserved with the request, so the withdrawable balance must cover both (request_withdrawal refuses
    otherwise) and a rejection returns both. The payout is still worth the requested credits only.
  */
  const flatFeeUsdCents = withdrawalFlatFeeCents(usdCents, input.config.sub.flatFees);
  const flatFeeCredits = Math.ceil((flatFeeUsdCents * w.creditsPerUsd) / 100);
  const base = { p_user_id: input.userId, p_credits: credits + flatFeeCredits, p_usd_cents: usdCents, p_method: input.method, p_details: details, p_snapshot: { creditsPerUsd: w.creditsPerUsd, version: input.config.version, depositedPart: split?.depositedPart ?? 0, deposited: w.deposited, requestedCredits: credits, flatFeeCredits, flatFeeUsdCents }, p_status: status };
  /*
    0278 (M1-M3): the eligibility, the suspension and both limits are decided in the SAME transaction as the hold, under
    the wallet's row lock, so two simultaneous requests cannot both pass a limit. Before 0278 runs, the live 0187
    function is called as before (the checks above still apply).
  */
  let { data, error } = await db.rpc("request_credit_withdrawal", { ...base, p_count_credits: credits, p_idempotency: idempotencyKey, p_max_per_day: w.maxRequestsPerDay, p_max_credits_month: w.maxCreditsPerMonth });
  if (error && MISSING_FN(error.message)) {
    console.warn("[rewards/withdraw] 0278 not applied yet: limits checked in the app only", { userId: input.userId });
    ({ data, error } = await db.rpc("request_withdrawal", base));
  }
  if (error) {
    console.error("[rewards/withdraw] request failed", { userId: input.userId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't submit that. Try again in a moment." };
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string; id?: string; duplicate?: boolean; status?: WithdrawalStatus };
  if (!out.ok || !out.id) {
    if (out.reason === "insufficient_withdrawable") return { ok: false, status: 409, error: `You don't have that many withdrawable credits (the amount plus the ${flatFeeCredits}-credit withdrawal fee).` };
    const [code, msg] = REFUSED[out.reason ?? ""] ?? [409, "Couldn't submit that."];
    return { ok: false, status: code, error: msg };
  }
  if (out.duplicate) return { ok: true, id: out.id, status: out.status ?? status, usdCents };
  console.info("[rewards/withdraw] requested", { userId: input.userId, id: out.id, credits, usdCents, status });
  return { ok: true, id: out.id, status, usdCents };
}

export async function resolveWithdrawal(input: { id: string; status: WithdrawalStatus; adminId: string | null; note?: string | null; payoutReference?: string | null }): Promise<{ ok: boolean; reason?: string }> {
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
      void emailMember(row.user_id, { subject: "Your withdrawal was updated", heading: "Withdrawal update", intro: body, ctaLabel: "View your rewards", ctaPath: "/rewards" }, "withdrawal_update");
    }
  }
  return { ok: !!out.ok, reason: out.reason };
}
