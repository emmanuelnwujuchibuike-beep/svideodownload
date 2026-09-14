import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { CHARACTER_REPLACE_PRODUCT, type CharacterReplaceQuote } from "@/lib/ai/character-replace/pricing";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the product wallet, from the server side
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 3, §2: "Character Replace MUST have its own balance… Do NOT silently
 * combine the two." This module is the only code that touches
 * `ai_product_balances` / `ai_product_ledger` (migration 0154), and it does so
 * exclusively through the five SECURITY DEFINER functions the migration
 * defines — the same rule lib/ai/balance.ts keeps for the AI Clean wallet,
 * which this file deliberately does not import: the two wallets share a
 * pattern and nothing else.
 *
 * ── The reservation lifecycle (§16/§27), as the ledger records it ───────────
 *
 *   reserve   processing_charge, status `reserved`, balance −total, snapshot
 *   settle    status → `settled` (the job completed; the charge stands)
 *   refund    a `refund` row, balance +total, charge status → `refunded`
 *             — at most once per job, by the ledger's unique index
 *
 * Part 3 builds and verifies these; Part 4 calls them from the job flow.
 */

export const PRODUCT = CHARACTER_REPLACE_PRODUCT;

export type CharacterReplaceLedgerKind = "recharge" | "processing_charge" | "refund" | "adjustment" | "reversal";
export type CharacterReplaceLedgerStatus = "settled" | "reserved" | "refunded" | "reversed";

export interface CharacterReplaceLedgerEntry {
  id: string;
  kind: CharacterReplaceLedgerKind;
  status: CharacterReplaceLedgerStatus;
  deltaCents: number;
  balanceAfterCents: number;
  currency: string;
  jobId: string | null;
  note: string | null;
  createdAt: string;
}

/** A missing row is ZERO — most members have never recharged. A failed read THROWS. */
export async function getCharacterReplaceBalanceCents(userId: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("ai_product_balances")
    .select("balance_cents")
    .eq("user_id", userId)
    .eq("product", PRODUCT)
    .maybeSingle();
  if (error) {
    // 🔴 Not zero: zero would send a member with credit to pay again.
    console.error("[cr/wallet] read failed", { userId, error: error.message });
    throw new Error(error.message);
  }
  return Number(data?.balance_cents ?? 0);
}

/**
 * The member's own statement. An allow-list of columns: no Paystack
 * reference, no admin id, no snapshot internals — the amounts and the kinds.
 */
export async function listCharacterReplaceLedger(userId: string, limit = 25): Promise<CharacterReplaceLedgerEntry[]> {
  const { data, error } = await createAdminClient()
    .from("ai_product_ledger")
    .select("id, kind, status, delta_cents, balance_after_cents, currency, job_id, note, created_at")
    .eq("user_id", userId)
    .eq("product", PRODUCT)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) {
    console.error("[cr/wallet] ledger read failed", { userId, error: error.message });
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as CharacterReplaceLedgerKind,
    status: row.status as CharacterReplaceLedgerStatus,
    deltaCents: Number(row.delta_cents),
    balanceAfterCents: Number(row.balance_after_cents),
    currency: row.currency as string,
    jobId: (row.job_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/**
 * Add to the balance — a verified Paystack recharge, or a refund keyed by
 * something other than a job. Idempotent on `reference`.
 */
export async function creditCharacterReplaceBalance(opts: {
  userId: string;
  amountCents: number;
  kind: Extract<CharacterReplaceLedgerKind, "recharge" | "refund">;
  reference: string;
  currency: string;
  note?: string | null;
  adminId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc("credit_product_balance", {
    p_user_id: opts.userId,
    p_product: PRODUCT,
    p_amount: Math.round(opts.amountCents),
    p_kind: opts.kind,
    p_reference: opts.reference,
    p_currency: opts.currency,
    p_note: opts.note ?? null,
    p_admin_id: opts.adminId ?? null,
    p_metadata: opts.metadata ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Reserve the price of one job: the deduction IS the authorisation, and it
 * THROWS when the balance will not cover it. Idempotent on the job id, so a
 * retried /start finds the reservation it already made rather than a second
 * charge. The snapshot is stored beside the row, immutably.
 */
export async function reserveCharacterReplaceCharge(opts: {
  userId: string;
  jobId: string;
  snapshot: CharacterReplaceQuote;
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc("reserve_product_charge", {
    p_user_id: opts.userId,
    p_product: PRODUCT,
    p_job_id: opts.jobId,
    p_amount: Math.round(opts.snapshot.totalCents),
    p_currency: opts.snapshot.currency,
    p_snapshot: opts.snapshot,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** The job completed: the reservation becomes the final charge. True when a row moved. */
export async function settleCharacterReplaceCharge(userId: string, jobId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("settle_product_charge", {
    p_user_id: userId,
    p_product: PRODUCT,
    p_job_id: jobId,
  });
  if (error) {
    console.error("[cr/wallet] settle failed", { userId, jobId, error: error.message });
    return false;
  }
  return data === true;
}

/**
 * Give back what a job reserved — at most once, whoever calls and however
 * often. Never throws: a refund that fails must not turn a failed job into a
 * failed request, and it is logged at error level because it is money.
 */
export async function refundCharacterReplaceCharge(userId: string, jobId: string, note?: string): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().rpc("refund_product_charge", {
      p_user_id: userId,
      p_product: PRODUCT,
      p_job_id: jobId,
      p_note: note ?? null,
    });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  } catch (e) {
    console.error("[cr/wallet] refund failed", { userId, jobId, error: String(e) });
    return null;
  }
}

/** An operator's manual credit or debit — with a reason and an actor, always. Idempotent on `reference`. */
export async function adjustCharacterReplaceBalance(opts: {
  userId: string;
  deltaCents: number;
  reference: string;
  note: string;
  adminId: string;
  currency: string;
}): Promise<number> {
  const { data, error } = await createAdminClient().rpc("adjust_product_balance", {
    p_user_id: opts.userId,
    p_product: PRODUCT,
    p_delta: Math.round(opts.deltaCents),
    p_reference: opts.reference,
    p_note: opts.note,
    p_admin_id: opts.adminId,
    p_currency: opts.currency,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/* ───────────────────────────── quote signatures ──────────────────────────── */

/**
 * A quote's `id` is an HMAC over the fields that decide its price. The browser
 * carries it around and hands it back when it confirms (Part 4); the server
 * then recomputes the price from the CURRENT configuration and checks BOTH
 * that the signature is genuine and that the total still matches — so a
 * quote cannot be edited in flight, and a price change between quote and
 * confirm is refused rather than silently honoured or silently raised.
 *
 * The key is the service-role secret unless a dedicated one is set; neither
 * ever reaches a client. Stateless on purpose: nothing has to be stored for a
 * quote that is never confirmed.
 */
function quoteKey(): string {
  const key = process.env.AI_QUOTE_SIGNING_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("no quote signing key configured");
  return key;
}

export function quoteCanonical(q: CharacterReplaceQuote): string {
  /*
    Part 6 added three signed fields — the MODE (a Face Only price handed
    back as a Full Character job would be a forged mode), the voice source
    and the dialogue length (a TTS price for 40 characters handed back with
    4,000 would be a forged voice price). A Full Character quote with the
    original audio canonicalises to the SAME string as before Part 6, so a
    quote a member was holding when this shipped still verifies.
  */
  const base: Record<string, unknown> = {
    p: q.product,
    v: q.pricingConfigVersion,
    d: q.durationMs,
    q: q.quality,
    vm: q.voiceMode,
    ls: q.lipSyncMode,
    t: q.totalCents,
    c: q.currency,
    e: q.expiresAt,
  };
  if (q.mode && q.mode !== "full_character") base.m = q.mode;
  if (q.voiceSource) base.vs = q.voiceSource;
  if (q.ttsCharacters) base.tc = q.ttsCharacters;
  return JSON.stringify(base);
}

export function signQuote(q: CharacterReplaceQuote): string {
  return createHmac("sha256", quoteKey()).update(quoteCanonical(q)).digest("base64url");
}

export function verifyQuoteSignature(q: CharacterReplaceQuote): boolean {
  try {
    const expected = Buffer.from(signQuote(q));
    const given = Buffer.from(q.id);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

/**
 * Whether a job's charge has come back — from the LEDGER, never inferred from
 * a status (Part 5, §16/§29): "refunded" when the processing_charge row is
 * marked refunded, "pending" when it is still reserved on a job that has
 * ended, "none" when there was no charge, "settled" when it was kept.
 */
export type CharacterReplaceRefundState = "none" | "settled" | "pending" | "refunded";

export async function characterReplaceRefundState(userId: string, jobId: string): Promise<CharacterReplaceRefundState> {
  try {
    const { data, error } = await createAdminClient()
      .from("ai_product_ledger")
      .select("status")
      .eq("user_id", userId)
      .eq("product", PRODUCT)
      .eq("kind", "processing_charge")
      .eq("job_id", jobId)
      .maybeSingle();
    if (error || !data) return "none";
    const status = (data as { status: string }).status;
    return status === "refunded" ? "refunded" : status === "reserved" ? "pending" : "settled";
  } catch {
    return "none";
  }
}

/**
 * The refund state of MANY jobs in one read — for a history page (Part 7
 * §18: "Never show 'Refunded' unless the financial system confirms the
 * refund"). Jobs with no processing charge are simply absent from the map.
 */
export async function characterReplaceRefundStates(userId: string, jobIds: readonly string[]): Promise<Map<string, CharacterReplaceRefundState>> {
  const out = new Map<string, CharacterReplaceRefundState>();
  if (!jobIds.length) return out;
  try {
    const { data, error } = await createAdminClient()
      .from("ai_product_ledger")
      .select("job_id, status")
      .eq("user_id", userId)
      .eq("product", PRODUCT)
      .eq("kind", "processing_charge")
      .in("job_id", [...jobIds]);
    if (error || !data) return out;
    for (const row of data as { job_id: string | null; status: string }[]) {
      if (!row.job_id) continue;
      out.set(row.job_id, row.status === "refunded" ? "refunded" : row.status === "reserved" ? "pending" : "settled");
    }
  } catch {
    /* an unreadable ledger leaves the status-based expectation in place, which never claims a refund */
  }
  return out;
}
