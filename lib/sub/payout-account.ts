import "server-only";

import { withdrawalFlatFeeCents } from "@/lib/rewards/config";
import { resolveAccount } from "@/lib/rewards/paystack-banks";
import { validatePayoutDetails } from "@/lib/rewards/withdrawals";
import { createAdminClient } from "@/lib/supabase/admin";

import { requestSubWithdrawal, subConfig, type Result } from "./server";

/**
 * The creator's saved SUB payout beneficiary and AUTO-WITHDRAWAL (owner,
 * 2026-10-11: "put an auto withdrawal mode in the profile sub and content sub so
 * they set up an account beneficiary and it saves for future records so every sub
 * goes straight to their balance").
 *
 * ── Saved once, verified by Paystack ──────────────────────────────────────
 * The bank and account number are checked with Paystack's account lookup when
 * saved, and the holder name stored is PAYSTACK'S, never a typed one. The row has
 * no RLS policy: only this server reads it, and the app is only ever sent the
 * bank, the holder name and the last four digits.
 *
 * ── Auto-withdrawal is an ordinary SUB withdrawal, requested for them ─────
 * With the switch on, each verified subscription payment (and the reconcile cron,
 * for money a hold released later) asks `request_sub_withdrawal` for the WHOLE
 * available balance to the saved account. Same SQL, same locks, same minimum, same
 * 10 % fee, same "one open withdrawal at a time", paid through Paystack at once
 * while `autoPayout` is on. The replay key is the creator's latest ledger row, so
 * the webhook and the return page racing on one payment ask once, not twice.
 * Nothing here can move money the SQL would refuse.
 */

type Row = Record<string, unknown>;
const MISSING = (m: string) => /schema cache|does not exist|column/i.test(m);
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

export interface PayoutAccountView {
  bankName: string;
  bankCode: string;
  last4: string;
  accountName: string;
  autoWithdraw: boolean;
  verifiedAt: string;
}

function view(r: Row): PayoutAccountView {
  return { bankName: r.bank_name as string, bankCode: r.bank_code as string, last4: String(r.account_number).slice(-4), accountName: r.account_name as string, autoWithdraw: !!r.auto_withdraw, verifiedAt: r.verified_at as string };
}

/** What the creator may see of their own saved account (masked). `ready` false before 0227. */
export async function getPayoutAccount(creatorId: string): Promise<{ account: PayoutAccountView | null; ready: boolean }> {
  const { data, error } = await createAdminClient().from("sub_payout_accounts").select("bank_code, bank_name, account_number, account_name, auto_withdraw, verified_at").eq("creator_id", creatorId).maybeSingle();
  if (error) return { account: null, ready: !MISSING(error.message) };
  return { account: data ? view(data as Row) : null, ready: true };
}

/** Save (or replace) the beneficiary. Paystack names the holder; a mismatch saves nothing. */
export async function savePayoutAccount(creatorId: string, input: { bankCode: string; bankName: string; accountNumber: string; autoWithdraw?: boolean }): Promise<Result<{ account: PayoutAccountView }>> {
  const d = validatePayoutDetails("paystack", input);
  if (!d) return fail("Pick your bank and enter a 10-digit account number.");
  const name = await resolveAccount(d.accountNumber, d.bankCode ?? "");
  if (!name) return fail("That account number doesn't match the bank. Check both.");
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: before } = await db.from("sub_payout_accounts").select("bank_code, account_number, auto_withdraw").eq("creator_id", creatorId).maybeSingle();
  const prev = before as Row | null;
  const auto = input.autoWithdraw ?? !!prev?.auto_withdraw;
  const { data, error } = await db
    .from("sub_payout_accounts")
    .upsert({ creator_id: creatorId, method: "paystack", bank_code: d.bankCode, bank_name: d.bankName, account_number: d.accountNumber, account_name: name.slice(0, 120), auto_withdraw: auto, verified_at: now, updated_at: now }, { onConflict: "creator_id" })
    .select("bank_code, bank_name, account_number, account_name, auto_withdraw, verified_at")
    .single();
  if (error) return MISSING(error.message) ? fail("Saved payout accounts arrive with the next update.", 503) : fail("Couldn't save that account.", 500);
  // a changed destination is a money decision: audited, with the last four digits only
  await db
    .from("financial_audit_log")
    .insert({ actor_id: creatorId, action: prev ? "payout_account_changed" : "payout_account_added", target_type: "sub_payout_account", target_id: creatorId, details: { bank: d.bankCode, last4: d.accountNumber.slice(-4), previous_last4: prev ? String(prev.account_number).slice(-4) : null, auto_withdraw: auto } })
    .then(undefined, () => {});
  /*
    2026-10-24 (fraud): the REAL owner hears about every new or changed payout account at once — a stolen session's
    first move is to point payouts somewhere else. Transactional (never silenced), and a new account also waits
    `newAccountHoldHours` before any instant payout can use it (lib/sub/payout-risk.ts).
  */
  if (!prev || prev.account_number !== d.accountNumber || prev.bank_code !== d.bankCode) {
    const { emailMember } = await import("@/lib/email/member-email");
    await emailMember(
      creatorId,
      {
        subject: "Your payout bank account was changed",
        heading: "New payout account",
        intro: `Your Frenz withdrawals will now go to ${d.bankName || "your bank"} account ending ${d.accountNumber.slice(-4)}. Instant payouts to it start after a short safety wait.`,
        body: "If this wasn't you, change your password now and contact support — no payout leaves to a new account during the safety wait.",
        ctaLabel: "Review payout settings",
        ctaPath: "/exclusive/dashboard",
      },
      "withdrawal_update").catch(() => "failed");
  }
  return { ok: true, account: view(data as Row) };
}

/** Turn auto-withdrawal on or off. On needs a saved account. */
export async function setAutoWithdraw(creatorId: string, on: boolean): Promise<Result<{ account: PayoutAccountView }>> {
  const db = createAdminClient();
  const { data, error } = await db.from("sub_payout_accounts").update({ auto_withdraw: on, updated_at: new Date().toISOString() }).eq("creator_id", creatorId).select("bank_code, bank_name, account_number, account_name, auto_withdraw, verified_at").maybeSingle();
  if (error) return MISSING(error.message) ? fail("Auto-withdrawal arrives with the next update.", 503) : fail("Couldn't save that.", 500);
  if (!data) return fail("Add your payout account first.", 409);
  await db.from("financial_audit_log").insert({ actor_id: creatorId, action: on ? "auto_withdraw_on" : "auto_withdraw_off", target_type: "sub_payout_account", target_id: creatorId }).then(undefined, () => {});
  return { ok: true, account: view(data as Row) };
}

export async function deletePayoutAccount(creatorId: string): Promise<Result> {
  const db = createAdminClient();
  const { error } = await db.from("sub_payout_accounts").delete().eq("creator_id", creatorId);
  if (error) return fail("Couldn't remove it.", 500);
  await db.from("financial_audit_log").insert({ actor_id: creatorId, action: "payout_account_removed", target_type: "sub_payout_account", target_id: creatorId }).then(undefined, () => {});
  return { ok: true };
}

/** The saved account as withdrawal details (server only — never sent to a browser). `autoOnly`: only when auto-withdrawal is on. */
export async function savedDetails(creatorId: string, autoOnly = true): Promise<{ bankCode: string; bankName: string; accountNumber: string } | null> {
  const { data } = await createAdminClient().from("sub_payout_accounts").select("bank_code, bank_name, account_number, auto_withdraw").eq("creator_id", creatorId).maybeSingle();
  const r = data as Row | null;
  return r && (!autoOnly || r.auto_withdraw) ? { bankCode: r.bank_code as string, bankName: r.bank_name as string, accountNumber: r.account_number as string } : null;
}

/**
 * Sweep the creator's whole available SUB balance to their saved account, when
 * auto-withdrawal is on. Quietly does nothing below the minimum, while another
 * withdrawal is open, or when withdrawals are paused — the next payment or the
 * cron tries again. Never throws.
 */
export async function autoWithdrawSub(creatorId: string, trigger: string): Promise<{ requested: boolean; reason?: string }> {
  try {
    const cfg = await subConfig();
    if (!cfg.withdrawalsEnabled) return { requested: false, reason: "paused" };
    const details = await savedDetails(creatorId);
    if (!details) return { requested: false, reason: "off" };
    const db = createAdminClient();
    await db.rpc("release_sub_earnings", { p_creator: creatorId });
    const [{ data: b }, { data: last }] = await Promise.all([
      db.from("sub_balances").select("available_cents").eq("creator_id", creatorId).maybeSingle(),
      db.from("sub_ledger").select("id").eq("creator_id", creatorId).order("id", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const available = Number((b as Row | null)?.available_cents ?? 0);
    /*
      0258: the flat withdrawal fee comes ON TOP of the amount, so the sweep withdraws what is left
      after it. The tiers rise with the amount, so the fee for (available - fee(available)) is never
      larger than fee(available): amount + its own fee always fits.
    */
    const amount = available - withdrawalFlatFeeCents(available, cfg.flatFees);
    if (amount < cfg.minWithdrawalCents) return { requested: false, reason: "below_minimum" };
    // the same balance state ⇒ the same key ⇒ the SQL answers a replay, never a second payout
    const key = `auto_${String((last as Row | null)?.id ?? "0")}_${creatorId.replace(/-/g, "").slice(0, 12)}`;
    const out = await requestSubWithdrawal({ userId: creatorId, grossCents: amount, details, idempotencyKey: key });
    if (!out.ok) {
      if (out.reason !== "open_exists") console.warn("[sub/auto-withdraw] not requested", { creatorId, trigger, reason: out.reason ?? out.error });
      return { requested: false, reason: out.reason ?? "refused" };
    }
    console.info("[sub/auto-withdraw] requested", { creatorId, trigger, id: out.id, status: out.status, paidOut: out.paidOut });
    return { requested: true };
  } catch (e) {
    console.error("[sub/auto-withdraw] failed", { creatorId, trigger, error: String(e).slice(0, 160) });
    return { requested: false, reason: "error" };
  }
}

/** The reconcile cron: auto-withdraw creators whose money became available since (a hold, or a withdrawal that finished). Bounded. */
export async function sweepAutoWithdrawals(limit = 25): Promise<{ checked: number; requested: number }> {
  const db = createAdminClient();
  const cfg = await subConfig();
  if (!cfg.withdrawalsEnabled) return { checked: 0, requested: 0 };
  const { data: autos, error } = await db.from("sub_payout_accounts").select("creator_id").eq("auto_withdraw", true).limit(500);
  if (error || !autos?.length) return { checked: 0, requested: 0 };
  const ids = (autos as Row[]).map((a) => a.creator_id as string);
  // one read decides who has anything to sweep; a creator with nothing costs nothing more
  const { data: due } = await db.from("sub_balances").select("creator_id").in("creator_id", ids).or(`available_cents.gte.${cfg.minWithdrawalCents},pending_cents.gt.0`).limit(limit);
  let requested = 0;
  for (const d of (due ?? []) as Row[]) if ((await autoWithdrawSub(d.creator_id as string, "cron")).requested) requested++;
  return { checked: (due ?? []).length, requested };
}
