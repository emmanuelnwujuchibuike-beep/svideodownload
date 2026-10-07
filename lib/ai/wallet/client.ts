import type { CharacterReplaceBalance, CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI WALLET — one balance, and a neutral door onto it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "text to audio shouldnt go through character replace,
 * character replace should work alone."
 *
 * There is ONE Frenz AI balance (0155) and every paid tool spends it — that
 * part is deliberate and stays. What was wrong is where the CODE lived: Text to
 * Audio, Lip Sync and Voice Cloning all had to import
 * `lib/ai/character-replace/client` to read a wallet that is not Character
 * Replace's, which makes one tool a dependency of every other and is exactly
 * what "standalone" rules out.
 *
 * So the wallet gets a neutral home. Every tool talks to THIS module; nothing
 * reaches into another tool's folder for money.
 *
 * ── 🔴 WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * Not a second wallet, not a second ledger, not a second Paystack integration.
 * The balance, the ledger and the checkout are the same ones they have always
 * been — `ai_product_balances` / `ai_product_ledger`, keyed by the product.
 * This is a door with a name that tells the truth, over plumbing that was
 * already shared.
 *
 * The TYPES are still imported from the Character Replace module rather than
 * copied, because two declarations of one shape is how two shapes begin. When
 * the Kling migration moves those types to a neutral home too, this import is
 * the one line that changes.
 */
export type AiWalletBalance = CharacterReplaceBalance;
export type AiWalletTransaction = CharacterReplaceTransaction;

export type AiWalletResult<T> = ({ ok: true } & T) | { ok: false; code: string; error: string };

async function request<T>(input: string, init?: RequestInit): Promise<AiWalletResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    const b = (body ?? {}) as { code?: string; error?: string };
    return { ok: false, code: b.code ?? "INTERNAL_ERROR", error: b.error ?? "Something went wrong. Try again in a moment." };
  }
  return { ok: true, ...((body ?? {}) as T) };
}

interface WalletBalanceResponse {
  balanceCents: number;
  currency: string;
  symbol: string;
  unit: "CREDIT";
  offer: AiWalletBalance["offer"];
  checkout?: AiWalletBalance["checkout"];
  freeAccess?: AiWalletBalance["freeAccess"];
  processing?: AiWalletBalance["processing"];
  transactions?: AiWalletTransaction[];
}

/** The member's Frenz AI balance and the figures the recharge sheet needs. */
export async function getAiWalletBalance(opts?: { ledger?: number }): Promise<AiWalletResult<{ balance: AiWalletBalance; transactions: AiWalletTransaction[] }>> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts?.ledger ?? 5)));
  const res = await request<WalletBalanceResponse>(`/api/ai/wallet/balance?ledger=${limit}`);
  if (!res.ok) return res;
  return {
    ok: true,
    balance: {
      balanceCents: res.balanceCents,
      currency: res.currency,
      symbol: res.symbol,
      unit: "CREDIT",
      offer: res.offer,
      checkout: res.checkout ?? null,
      freeAccess: res.freeAccess ?? null,
      processing: res.processing ?? null,
    },
    transactions: res.transactions ?? [],
  };
}

/**
 * Begin buying credits (0184): a pack id from the offer, or a typed number of
 * credits. Answers with the payment page; nothing here moves money — the
 * server re-checks the choice against the offer and prices it itself.
 */
export function beginAiWalletTopup(choice: { packId: string } | { credits: number }, returnTo: string): Promise<AiWalletResult<{ url: string }>> {
  return request("/api/ai/wallet/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...choice, returnTo }) });
}

/**
 * What a tool shows about plan credits for one generation. Re-homed here on
 * 2026-09-27 for the same reason as the balance: credits belong to the member,
 * not to Character Replace, and three tools importing that folder for a type
 * is three tools coupled to it.
 */
export type AiCreditsView = import("@/lib/ai/character-replace/types").CharacterReplaceCreditsView;
