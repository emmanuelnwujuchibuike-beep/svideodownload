import "server-only";

import { after } from "next/server";

import { settleFlutterwaveTopup } from "@/lib/ai/wallet/flutterwave-settle";
import { settleCharacterReplaceCharge, settleUnpaidTopup } from "@/lib/ai/wallet/paystack-settle";
import { flutterwaveConfigured, getFlutterwaveConfig } from "@/lib/flutterwave/config";
import { isFlutterwaveReference } from "@/lib/payments/references";
import { CHARACTER_REPLACE_TOPUP_PURPOSE, paystackEnabled, paystackRefusedForSure, verifyTransaction } from "@/lib/paystack/paystack";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WALLET TOP-UPS ARE SETTLED EVEN WHEN NOBODY COMES BACK (Part 3, 2026-10-23)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One routine (`reconcileTopupAttempt`) settles one open top-up attempt from its OWN provider's record,
 * and three callers use it:
 *   · the scheduled sweep (`reconcilePendingTopups`), from the 10-minute ai-reconcile cron — the recovery
 *     that no longer depends on the member opening their wallet (Part 2 gap);
 *   · the member's own wallet read (`reconcileMemberTopups`), opportunistic, as before;
 *   · a new checkout (`resolveHeldTopups`): an attempt whose outcome is unknown is resolved FIRST.
 *
 * The rules, for both rails:
 *   · the provider is the one written on the attempt row — never a browser's word, never re-chosen;
 *   · the charge must be for OUR reference and the row's member; Paystack's amount/currency go through
 *     the one crediting rule (resolveCredit), Flutterwave's through the EXACT match (chargeMatches);
 *   · crediting is `credit_product_balance`, once per reference — a webhook, a return page and this sweep
 *     racing credit once;
 *   · a verify that fails (timeout, 5xx) proves nothing: the attempt stays open for the next pass;
 *   · a charge that does not match the attempt is set to `mismatch` and left for a person — never guessed;
 *   · terminal rows (success, failed, abandoned, mismatch) are never asked again.
 * Open attempts are claimed with a compare-and-set on `updated_at` before the provider is asked, so two
 * sweeps (or a sweep and a wallet read) never work the same row at once; the settle stays idempotent anyway.
 */

const OPEN = ["pending", "verification_required"] as const;
const CANCEL_AFTER_MS = 30 * 60_000;
const MIN_AGE_MS = 60_000;
const WINDOW_MS = 7 * 86_400_000;
/** an attempt is asked at most once per this interval, whoever asks */
const RECHECK_MS = 5 * 60_000;

export interface TopupAttemptRow {
  reference: string;
  user_id: string;
  provider: string;
  status: string;
  created_at: string;
  updated_at: string;
  checkout_url: string | null;
}
const COLUMNS = "reference, user_id, provider, status, created_at, updated_at, checkout_url";
/** The columns a TopupAttemptRow needs (Part 5: the admin recheck reads a row the same way the sweep does). */
export const TOPUP_ATTEMPT_COLUMNS = COLUMNS;

export type TopupReconcileOutcome = "settled" | "pending" | "failed" | "mismatched" | "verification_failed" | "skipped";

async function setStatus(reference: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_topup_attempts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("reference", reference)
    .in("status", [...OPEN]);
  if (error) console.error("[ai/topup/reconcile] status update failed", { reference });
}

/** Take the row for this pass: only the caller whose conditional update moved `updated_at` works it. */
/**
 * A LEASE, not just a compare-and-set (Part 3.1): the claim moves updated_at LEASE_MS into the FUTURE. Nobody can
 * claim a row whose updated_at is still ahead of now — so a worker that reads the row AFTER another claimed it
 * (webhook, return page, cron) is refused until the holder finishes (every status change sets updated_at = now)
 * or the lease runs out (a crash). The sweeps only select rows last touched before now − RECHECK, never a held one.
 */
const LEASE_MS = 2 * 60_000;

async function claim(row: TopupAttemptRow): Promise<boolean> {
  if (Date.parse(row.updated_at) > Date.now()) return false;
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .update({ updated_at: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("reference", row.reference)
    .eq("updated_at", row.updated_at)
    .in("status", [...OPEN])
    .select("reference");
  return !error && (data?.length ?? 0) > 0;
}

/**
 * Settle ONE open wallet top-up from its recorded provider. `announce` runs the once-only push/receipt
 * off the money path. Never throws: an unreachable provider is `verification_failed` (the row stays open).
 */
export async function reconcileTopupAttempt(row: TopupAttemptRow, opts: { claimed?: boolean } = {}): Promise<TopupReconcileOutcome> {
  if (!(OPEN as readonly string[]).includes(row.status)) return "skipped";
  if (!opts.claimed && !(await claim(row))) return "skipped";
  try {
    if (row.provider === "flutterwave") {
      if (!isFlutterwaveReference(row.reference)) return "mismatched";
      // the API can't be asked without a key: left open, asked again once it is set
      if (!flutterwaveConfigured(await getFlutterwaveConfig())) return "skipped";
      const out = await settleFlutterwaveTopup(row.reference, { userId: row.user_id });
      if (out.kind === "credited") {
        after(out.announce);
        return "settled";
      }
      if (out.kind === "pending") return "pending";
      if (out.kind === "failed") return "failed";
      return "mismatched";
    }
    if (row.provider === "paystack") {
      if (!row.reference.startsWith(`${CHARACTER_REPLACE_TOPUP_PURPOSE}_`) || isFlutterwaveReference(row.reference)) return "mismatched";
      if (!(await paystackEnabled())) return "skipped";
      let charge;
      try {
        charge = await verifyTransaction(row.reference);
      } catch (e) {
        // Paystack has no transaction for a checkout whose creation outcome was unknown and whose link was never handed out: never created
        if (paystackRefusedForSure(e) && row.status === "verification_required" && !row.checkout_url) {
          await setStatus(row.reference, { status: "failed", status_reason: "paystack checkout never created" });
          return "failed";
        }
        return "verification_failed";
      }
      if ((charge.reference && charge.reference !== row.reference) || charge.metadata?.user_id !== row.user_id) {
        await setStatus(row.reference, { status: "mismatch", status_reason: "paystack charge is not this attempt's" });
        return "mismatched";
      }
      if (charge.status === "success") {
        const settled = await settleCharacterReplaceCharge(row.user_id, row.reference, charge);
        if (settled.kind === "credited") {
          after(settled.announce);
          return "settled";
        }
        // paid but not creditable as asked (currency / amount / pin): a person reviews it — never re-asked
        await setStatus(row.reference, { status: "mismatch", status_reason: "paystack charge not creditable", paid_amount: Number(charge.amount) || null, paid_currency: charge.currency ?? null });
        return "mismatched";
      }
      const old = Date.now() - Date.parse(row.created_at) >= CANCEL_AFTER_MS;
      if (charge.status === "failed" || (charge.status === "abandoned" && old)) {
        await settleUnpaidTopup({ userId: row.user_id, reference: row.reference, outcome: charge.status, amountCents: Number(charge.amount), currency: charge.currency ?? "", gatewayResponse: charge.gateway_response ?? null, channel: charge.channel ?? null });
        return "failed";
      }
      return "pending";
    }
    // a removed provider's history (Bachs) is never asked, settled or released by code
    return "skipped";
  } catch (e) {
    console.warn("[ai/topup/reconcile] check failed", { reference: row.reference, provider: row.provider, error: e instanceof Error ? e.name : "unknown" });
    return "verification_failed";
  }
}

export interface ReconcileSummary {
  examined: number;
  settled: number;
  pending: number;
  failed: number;
  mismatched: number;
  verificationFailed: number;
  skipped: number;
}
const empty = (): ReconcileSummary => ({ examined: 0, settled: 0, pending: 0, failed: 0, mismatched: 0, verificationFailed: 0, skipped: 0 });
function tally(s: ReconcileSummary, o: TopupReconcileOutcome): void {
  s.examined += 1;
  if (o === "verification_failed") s.verificationFailed += 1;
  else s[o] += 1;
}

/**
 * The scheduled sweep (the 10-minute ai-reconcile cron). Bounded: at most `limit` attempts, oldest first,
 * between 2 minutes and 7 days old, not asked in the last RECHECK_MS, and a time budget so a slow provider
 * can't hold the run. Sequential, so neither provider's rate limit is hammered; one failure never stops
 * the rest. Aggregates only — no references, members or amounts in the result.
 */
export async function reconcilePendingTopups(opts: { limit?: number; budgetMs?: number; now?: number } = {}): Promise<ReconcileSummary> {
  const now = opts.now ?? Date.now();
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const out = empty();
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select(COLUMNS)
    .eq("purpose", "wallet_topup")
    .in("provider", ["paystack", "flutterwave"])
    .in("status", [...OPEN])
    .lte("created_at", new Date(now - 2 * MIN_AGE_MS).toISOString())
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("updated_at", new Date(now - RECHECK_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return out;
  for (const row of (data ?? []) as TopupAttemptRow[]) {
    if (Date.now() > deadline) break;
    tally(out, await reconcileTopupAttempt(row));
  }
  return out;
}

/** The member's own recent open top-ups, asked when they open their wallet (opportunistic; the cron is the guarantee). */
export async function reconcileMemberTopups(userId: string): Promise<{ credited: number }> {
  const now = Date.now();
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("purpose", "wallet_topup")
    .in("provider", ["paystack", "flutterwave"])
    .in("status", [...OPEN])
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("created_at", new Date(now - MIN_AGE_MS).toISOString())
    .lte("updated_at", new Date(now - RECHECK_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data?.length) return { credited: 0 };
  let credited = 0;
  for (const row of data as TopupAttemptRow[]) if ((await reconcileTopupAttempt(row)) === "settled") credited += 1;
  return { credited };
}

/** Bounded: the wallet answers within `ms` whatever the providers do; a slow check finishes on the next open. */
export function reconcileMemberTopupsWithin(userId: string, ms = 4000): Promise<{ credited: number }> {
  return Promise.race([
    reconcileMemberTopups(userId).catch(() => ({ credited: 0 })),
    new Promise<{ credited: number }>((resolve) => setTimeout(() => resolve({ credited: 0 }), ms)),
  ]);
}

/**
 * Before a NEW top-up checkout, on either rail: any of this member's attempts whose checkout creation had
 * an UNKNOWN outcome (status verification_required) is resolved first. Released (never created) or settled
 * → clear; still open or unreachable → "held": no second checkout while the first might be paid.
 */
export async function resolveHeldTopups(userId: string): Promise<"clear" | "held" | "unavailable"> {
  const { data, error } = await createAdminClient()
    .from("ai_topup_attempts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("purpose", "wallet_topup")
    .in("provider", ["paystack", "flutterwave"])
    .eq("status", "verification_required")
    .gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .limit(5);
  // the ledger can't be read: no checkout at all (nothing could be recorded either)
  if (error) return "unavailable";
  for (const row of (data ?? []) as TopupAttemptRow[]) {
    const o = await reconcileTopupAttempt(row, { claimed: true });
    if (o !== "settled" && o !== "failed") return "held";
  }
  return "clear";
}
