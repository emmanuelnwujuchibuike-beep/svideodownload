import "server-only";

import { createFlutterwaveTransfer, flutterwaveFailureIsDefinite, resolveFlutterwaveAccount } from "@/lib/flutterwave/client";
import { getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { getLandingSettings } from "@/lib/landing/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { FLUTTERWAVE_REF } from "./payout-refs";
import { PAYSTACK_METHOD, payWithdrawalViaPaystack } from "./paystack-payouts";
import { payoutQuote } from "./payout-quote";
import { coinPayoutRail, DEFAULT_PAYOUT_ROUTE, normalizePayoutRoute, payoutDestinationCountry, type PayoutRoute } from "./payout-rail";
import { resolveWithdrawal } from "./withdrawals";

/**
 * Flutterwave payouts — Exclusive withdrawals leave through Flutterwave (owner, 2026-10-24: "exclusive users don't
 * withdraw through paystack anymore, they withdraw through Flutterwave or any I set by admin").
 *
 *   rail       the admin's route (Admin → SUB / Frenz Coin → "Payout provider", lib/rewards/payout-rail.ts): Flutterwave
 *              only by default. Paystack is a backup ONLY on the "Flutterwave, with Paystack as backup" route, and only
 *              when Flutterwave definitely sent nothing: it is not configured, it refused the account lookup or the
 *              transfer with a 4xx, or the account holder it names doesn't match the one the member confirmed (the
 *              member picked their bank from Paystack's list; a code Flutterwave reads as a different bank must never
 *              receive the money).
 *   reference  frenz_fwd_<withdrawal id> — fixed per withdrawal, so a retry can never pay twice, and distinct from
 *              Paystack's frenz_wd_ so every later step (reject, webhook, reconcile) asks the rail that sent it.
 *   unknown    a timeout / 5xx / non-JSON answer is NOT a failure: the withdrawal moves to processing with the
 *              reference, the money stays held, nothing else is sent, and the reconcile sweep / webhook settle it.
 *   amount     the withdrawal's USD value at the live NGN market rate (the same as the Paystack rail).
 *
 * Flutterwave account requirements: Transfers enabled, the server's IP whitelisted if IP whitelisting is on, and a
 * funded NGN balance. A refusal for any of these is returned to the admin (Flutterwave only) — or, on the backup route,
 * hands the withdrawal to Paystack (definite: nothing was sent).
 */


type Row = Record<string, unknown>;
type PayResult = { ok: true; status: string; provider: "flutterwave" | "paystack" } | { ok: false; error: string };

/** Token-wise name match, order and case ignored: every word of the shorter name must appear in the other. */
export function sameAccountHolder(a: string, b: string): boolean {
  const words = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.every((w) => long.has(w));
}

/** The admin's route for Exclusive withdrawals (Admin → SUB → Payout provider) — Flutterwave only when unreadable. */
export async function subPayoutRoute(): Promise<PayoutRoute> {
  try {
    return normalizePayoutRoute((await getLandingSettings()).frenzRewards.sub.payoutProvider);
  } catch {
    return DEFAULT_PAYOUT_ROUTE;
  }
}

/**
 * The route for a Frenz Coin withdrawal (Admin → Frenz Coin → Payout provider) — Flutterwave only when unreadable.
 * `by_country` resolves to the ONE rail of the bank's country (Nigeria, Ghana, South Africa, Kenya by Paystack, beyond by
 * Flutterwave — the 2026-10-27 rule), never to a backup pair.
 */
async function coinPayoutRoute(w: Row): Promise<PayoutRoute> {
  let choice: unknown = DEFAULT_PAYOUT_ROUTE;
  try {
    choice = (await getLandingSettings()).frenzCoin.payoutProvider;
  } catch {
    /* the default route */
  }
  return choice === "by_country" ? coinPayoutRail(payoutDestinationCountry(w)) : normalizePayoutRoute(choice);
}

/**
 * Pay one withdrawal through the admin's route — the only door every payout uses (the instant auto-payout and the
 * admin's Pay button).
 *
 * 🔴 ONE CLEAN PATH (owner, 2026-10-29: "Withdrawal must be clean path through the provider selected by admin not two or
 * any backup"). Flutterwave only and Paystack only each use exactly that provider: a refusal is returned to the caller
 * and the withdrawal stays approved with the money held — nothing is ever re-sent through the other rail. Paystack is a
 * backup ONLY when the admin chose "Flutterwave, with Paystack as backup", and even then only after Flutterwave
 * definitely sent nothing (lib/rewards/payout-rail.ts PAYOUT_ROUTES).
 */
export async function payWithdrawal(withdrawalId: string, adminId: string | null): Promise<PayResult> {
  const { data: head } = await createAdminClient().from("withdrawal_requests").select("source, payout_method, payout_details").eq("id", withdrawalId).maybeSingle();
  const w = head as Row | null;
  const route = w?.source === "coin" ? await coinPayoutRoute(w) : await subPayoutRoute();
  if (route === "paystack") {
    const p = await payWithdrawalViaPaystack(withdrawalId, adminId);
    return p.ok ? { ...p, provider: "paystack" } : p;
  }
  const fw = await payWithdrawalViaFlutterwave(withdrawalId, adminId);
  if (fw.ok) return { ok: true, status: fw.status, provider: "flutterwave" };
  if (route !== "flutterwave_paystack_backup" || !fw.fallback) return { ok: false, error: fw.error };
  console.warn("[rewards/payout] fallback_triggered", { from: "flutterwave", to: "paystack", withdrawal: withdrawalId, why: fw.error });
  const p = await payWithdrawalViaPaystack(withdrawalId, adminId);
  return p.ok ? { ...p, provider: "paystack" } : p;
}

/** `fallback: true` = Flutterwave definitely sent nothing, so the Paystack rail may be tried. */
export async function payWithdrawalViaFlutterwave(withdrawalId: string, adminId: string | null): Promise<{ ok: true; status: string } | { ok: false; error: string; fallback: boolean }> {
  const db = createAdminClient();
  const { data } = await db.from("withdrawal_requests").select("*").eq("id", withdrawalId).maybeSingle();
  const w = data as Row | null;
  if (!w) return { ok: false, error: "Not found.", fallback: false };
  if (w.payout_method !== PAYSTACK_METHOD) return { ok: false, error: "This withdrawal isn't to a Nigerian bank account.", fallback: false };
  if (!["pending", "reviewing", "approved"].includes(w.status as string)) return { ok: false, error: `It is already ${w.status as string}.`, fallback: false };
  const details = (w.payout_details ?? {}) as Row;
  const bankCode = String(details.bankCode ?? "");
  const accountNumber = String(details.accountNumber ?? "");
  const accountName = String(details.accountName ?? "");
  if (!bankCode || !accountNumber || !accountName) return { ok: false, error: "The bank details are incomplete.", fallback: false };

  const cfg = await getFlutterwaveConfig();
  if (!cfg.secretKey) return { ok: false, error: "Flutterwave isn't configured.", fallback: true };

  // closeout: credits / SUB at the live market rate as before; a Frenz Coin payout at its approved, recorded rate
  const quote = await payoutQuote(w);
  if (!quote.ok) return { ok: false, error: quote.error, fallback: false };
  const kobo = quote.kobo;
  if (kobo < 10_000) return { ok: false, error: "The payout is below the minimum transfer.", fallback: false };

  // the account Flutterwave would pay must be the one the member confirmed — never a different bank under the same code
  try {
    const named = await resolveFlutterwaveAccount(accountNumber, bankCode, { cfg });
    if (!sameAccountHolder(named, accountName)) return { ok: false, error: "Flutterwave names a different account holder for these bank details.", fallback: true };
  } catch (e) {
    return { ok: false, error: `Flutterwave couldn't confirm the account: ${e instanceof Error ? e.message : "unknown"}`, fallback: flutterwaveFailureIsDefinite(e) };
  }

  // approved first, so a failure from here on is a withdrawal waiting to be paid, never lost money
  if (w.status !== "approved") {
    const moved = await resolveWithdrawal({ id: withdrawalId, status: "approved", adminId, note: "Approved for payout" });
    if (!moved.ok) return { ok: false, error: "Couldn't approve it.", fallback: false };
  }
  const reference = FLUTTERWAVE_REF(withdrawalId);
  /*
    The reference is RECORDED before Flutterwave is called: from here on every reject / settle / reconcile asks
    Flutterwave about this withdrawal, so a transfer whose answer was lost can never be released by mistake. An
    approved withdrawal with NO recorded reference therefore provably never went to Flutterwave. If the write fails,
    nothing is sent.
  */
  const { data: cur } = await db.from("withdrawal_requests").select("payout_reference").eq("id", withdrawalId).maybeSingle();
  const had = ((cur as Row | null)?.payout_reference as string | null | undefined) ?? null;
  // another rail's reference on the row means a transfer may already exist there: never send a second one
  if (had && had !== reference) return { ok: false, error: "Another payout was already attempted for this withdrawal. Check it before paying again.", fallback: false };
  const markQ = db.from("withdrawal_requests").update({ payout_reference: reference, updated_at: new Date().toISOString() }).eq("id", withdrawalId).eq("status", "approved");
  const { data: marked, error: markError } = await (had ? markQ.eq("payout_reference", reference) : markQ.is("payout_reference", null)).select("id");
  if (markError || !(marked ?? []).length) return { ok: false, error: "Couldn't record the payout reference, so nothing was sent.", fallback: false };
  /** Flutterwave DEFINITELY sent nothing: the reference is taken back off so the Paystack rail's own rules apply. */
  const unmark = async () => {
    const { error } = await db.from("withdrawal_requests").update({ payout_reference: null, updated_at: new Date().toISOString() }).eq("id", withdrawalId).eq("status", "approved").eq("payout_reference", reference);
    return !error;
  };
  let status = "NEW";
  let uncertain = false;
  try {
    status = (await createFlutterwaveTransfer({ reference, amountMinor: kobo, bankCode, accountNumber, narration: "Frenz withdrawal" }, { cfg })).status;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/reference/i.test(msg) && /exist|duplicate|already/i.test(msg)) {
      // a reused reference means it was already sent: the idempotency working, not a failure
    } else if (flutterwaveFailureIsDefinite(e)) {
      // a 4xx: no transfer exists. The withdrawal stays approved and the Paystack rail may send it — only once the
      // Flutterwave reference is off the row (else a later Paystack outcome would be checked against the wrong rail)
      return { ok: false, error: `Flutterwave didn't send it: ${msg}`, fallback: await unmark() };
    } else {
      uncertain = true;
    }
  }
  const done = status === "SUCCESSFUL" && !uncertain;
  const note = uncertain
    ? `Outcome unknown: the transfer request to Flutterwave didn't get a clear answer. Held until Flutterwave confirms by reference ${reference}.`
    : `Flutterwave transfer of NGN ${(kobo / 100).toFixed(2)} at ${quote.label}`;
  const out = await resolveWithdrawal({ id: withdrawalId, status: done ? "completed" : "processing", adminId, note, payoutReference: reference });
  if (uncertain) return out.ok ? { ok: true, status: "unknown" } : { ok: false, error: "The transfer's outcome is unknown and the withdrawal didn't update. Don't pay it again: check the reference in Flutterwave.", fallback: false };
  return out.ok ? { ok: true, status: status.toLowerCase() } : { ok: false, error: "Sent, but the withdrawal didn't update. The webhook will finish it.", fallback: false };
}
