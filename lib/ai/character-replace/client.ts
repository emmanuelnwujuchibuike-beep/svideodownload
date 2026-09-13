"use client";

import { readAiBalanceCache } from "@/lib/ai/balance-cache";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceBalance, CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import type { AiErrorCode } from "@/lib/ai/errors";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the browser's two reads
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The workspace needs exactly two things from the server before a member can
 * do anything: what the tool OFFERS (the public config) and what the member
 * HAS (the balance). Both are reads; neither moves money or starts work.
 *
 * ── 🔴 THE BALANCE IS THE PLATFORM WALLET, PRESENTED AS THIS TOOL'S ──────────
 *
 * Owner, 2026-09-13 (Part 1, §8): a separate "Character Replace balance",
 * "unless the existing architecture proves that a shared wallet is already
 * deliberately designed for multiple AI products."
 *
 * It is, and the proof is in the schema rather than in a comment:
 *
 *   · `ai_balances` is keyed by MEMBER, not by tool (migration 0149), and the
 *     functions that move it — `credit_ai_balance`, `charge_ai_balance`,
 *     `refund_ai_charge` — take a job id, never a feature;
 *   · every charge and refund in `ai_balance_ledger` is joined to `ai_jobs`
 *     by `job_id`, and `ai_jobs.feature` is a column — so a per-tool statement
 *     is a WHERE clause, not a second table;
 *   · the Paystack top-up, the receipt email, the deposit notification and
 *     the admin credit all write the one wallet.
 *
 * And the other half of the owner's condition no longer applies: AI Clean is
 * removed the same day, so there is no "AI Clean balance" for this one to be
 * kept apart from. Money members have already deposited sits in this wallet;
 * a second one would strand it. So `CharacterReplaceBalance` is an
 * ABSTRACTION over `/api/ai/balance` — the card, the recharge and the
 * statement all go through it, and if the owner ever wants product-separated
 * wallets, this file is the only place the interface would change.
 */

export type CharacterReplaceClientResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AiErrorCode | "NETWORK"; error: string };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<CharacterReplaceClientResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an empty body is handled below */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: AiErrorCode; error?: string };
    return {
      ok: false,
      code: b.code ?? "INTERNAL_ERROR",
      error: b.error ?? "Something went wrong. Try again in a moment.",
    };
  }
  return { ok: true, ...((body ?? {}) as T) };
}

/** What the tool offers, and whether it is on for this member. */
export async function getCharacterReplaceConfig(): Promise<
  CharacterReplaceClientResult<{ config: CharacterReplacePublicConfig; available: boolean; audience: string }>
> {
  return request("/api/ai/character-replace/config");
}

/** The raw shape `/api/ai/balance` answers with; only the fields this tool reads. */
interface BalanceResponse {
  balanceCents: number;
  currency: string;
  symbol: string;
  topupOptionsCents: number[];
  minTopupCents: number;
  maxTopupCents: number;
  ledger: CharacterReplaceTransaction[];
}

/**
 * The member's balance, shaped for the balance card, and their recent
 * transactions. One request to the platform wallet endpoint.
 */
export async function getCharacterReplaceBalance(opts?: { ledger?: number }): Promise<
  CharacterReplaceClientResult<{ balance: CharacterReplaceBalance; transactions: CharacterReplaceTransaction[] }>
> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.ledger ?? 5)));
  const res = await request<BalanceResponse>(`/api/ai/balance?ledger=${limit}`);
  if (!res.ok) return res;
  const balance: CharacterReplaceBalance = {
    balanceCents: res.balanceCents,
    currency: res.currency,
    symbol: res.symbol,
    topupOptionsCents: res.topupOptionsCents,
    minTopupCents: res.minTopupCents,
    maxTopupCents: res.maxTopupCents,
  };
  return { ok: true, balance, transactions: res.ledger ?? [] };
}

/**
 * The last figure this browser saw, for the first paint.
 *
 * The wallet is the platform's, so the platform's cache is the right one to
 * read: the dashboard (features/ai/frenz-ai-dashboard.tsx) writes its whole
 * state under one key with a 24 h TTL, and the fields this card needs are a
 * subset of it. READ ONLY — writing this tool's narrower shape into that key
 * would hand the dashboard a snapshot missing the counters and the ledger it
 * renders from. Nothing here is authoritative; the network answer replaces it.
 */
export function readCachedCharacterReplaceBalance(): CharacterReplaceBalance | null {
  const cached = readAiBalanceCache<Partial<BalanceResponse>>();
  if (!cached || typeof cached.balanceCents !== "number" || typeof cached.symbol !== "string") return null;
  return {
    balanceCents: cached.balanceCents,
    currency: cached.currency ?? "",
    symbol: cached.symbol,
    topupOptionsCents: Array.isArray(cached.topupOptionsCents) ? cached.topupOptionsCents : [],
    minTopupCents: cached.minTopupCents ?? 0,
    maxTopupCents: cached.maxTopupCents ?? 0,
  };
}

/**
 * Begin a recharge. The server validates the amount against the operator's
 * bounds and answers with Paystack's hosted page; the browser navigates there
 * — a full navigation, never a popup — and Paystack returns the member to
 * `returnTo` (allow-listed server-side; anything else becomes the default).
 *
 * 🔴 Nothing here credits anything. The credit happens when Paystack's webhook
 * or the verify-on-return route confirms the payment, idempotently on the
 * reference (lib/ai/balance.ts). This function only asks for the page.
 */
export async function beginCharacterReplaceTopup(amountCents: number, returnTo: string): Promise<
  CharacterReplaceClientResult<{ url: string }>
> {
  return request("/api/ai/balance/topup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amountCents, returnTo }),
  });
}

/**
 * Finish a recharge the member came back from.
 *
 * Paystack appends `?reference=` (alias `trxref`) to the return URL. The
 * caller reads it ONCE, strips it from the address bar, and hands it here;
 * the server asks Paystack, checks the payment is this member's, and credits
 * under the same reference the webhook uses — so whichever lands first
 * credits once (lib/ai/balance.ts). `credited` is the wallet moving;
 * `pending` is Paystack still confirming.
 */
export async function verifyCharacterReplaceTopup(reference: string): Promise<
  CharacterReplaceClientResult<{ credited?: boolean; pending?: boolean }>
> {
  return request("/api/ai/balance/topup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference }),
  });
}

/**
 * Pull a Paystack return reference out of the address bar, if there is one,
 * and remove it so a reload, a bookmark or a back-swipe never re-verifies.
 * Returns the reference, or null when this is an ordinary visit.
 */
export function takeTopupReturnReference(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") ?? params.get("trxref");
  if (!reference) return null;
  params.delete("reference");
  params.delete("trxref");
  const rest = params.toString();
  const clean = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", clean);
  return reference;
}
