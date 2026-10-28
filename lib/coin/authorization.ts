import "server-only";

import type { FrenzCoinConfig } from "@/lib/coin/config";
import { beginPinProof } from "@/lib/coin/pin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN — FINANCIAL TRANSACTION AUTHORIZATION (Part 4 fail-closed → Part 4.2 transaction PIN → closeout)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A transfer or a withdrawal is confirmed with the member's six-digit TRANSACTION PIN (lib/coin/pin.ts, 0282 / 0283) —
 * never the messaging quick-lock PIN, never the session alone. What this module hands the money functions is not a
 * reusable token: it is ONE counted, single-use PIN attempt (begun in the database for this member and this purpose,
 * two minutes) and the key derived from what the member typed. `transfer_coins_with_pin` /
 * `request_coin_withdrawal_with_pin` check that key against the stored hash and run the operation in the same database
 * transaction, spending the attempt — so a proof cannot be replayed, used twice at once, used for the other purpose, or
 * moved onto another recipient or amount (those are arguments of the same call). transfer_coins and
 * request_coin_withdrawal are not callable by any API role (0282 / 0283).
 *
 * Fails closed: no pepper configured, no PIN set, a locked PIN, a malformed PIN, the database unreachable — no proof.
 * Tests reach the money paths by mocking `isCoinTransferAuthorized` only; nothing here can mint a proof without a begun
 * attempt, and the database still checks the key.
 */

declare const issued: unique symbol;
/** What a PIN proof is for: a proof for one never authorizes the other (the database checks the attempt's purpose too). */
export type CoinAuthorizedAction = "transfer" | "withdrawal" | "gift";
/** One counted PIN attempt and its derived key, for ONE operation by ONE member. Only this module makes one. */
export type CoinTransferAuthorization = { readonly [issued]: true; readonly userId: string; readonly attemptId: string; readonly keyHex: string; readonly method: "transaction_pin"; readonly purpose: CoinAuthorizedAction };

const ISSUED = new WeakSet<object>();

export type CoinAuthorizationOutcome = { ok: true; authorization: CoinTransferAuthorization } | { ok: false; reason: "authorization_failed" | "unavailable" };

/** Begin the PIN proof for a transfer by `userId`. `pin` is what the member typed; it is never logged or stored. */
export async function authorizeCoinTransfer(userId: string, pin: unknown, config: FrenzCoinConfig): Promise<CoinAuthorizationOutcome> {
  return authorizeCoinAction(userId, pin, "transfer", config);
}

/** Closeout: the same proof for a coin WITHDRAWAL (a counted 'withdrawal' attempt, 0283). */
export async function authorizeCoinWithdrawal(userId: string, pin: unknown, config: FrenzCoinConfig): Promise<CoinAuthorizationOutcome> {
  return authorizeCoinAction(userId, pin, "withdrawal", config);
}

/** Frenz Gift Coin Part 4: the same proof for a sticker GIFT (a counted 'gift' attempt, 0293). A transfer proof never authorizes a gift. */
export async function authorizeGift(userId: string, pin: unknown, config: FrenzCoinConfig): Promise<CoinAuthorizationOutcome> {
  return authorizeCoinAction(userId, pin, "gift", config);
}

async function authorizeCoinAction(userId: string, pin: unknown, purpose: CoinAuthorizedAction, config: FrenzCoinConfig): Promise<CoinAuthorizationOutcome> {
  const proof = await beginPinProof(userId, pin, purpose, config);
  if (!proof.ok) return { ok: false, reason: proof.reason };
  const authorization = { userId, attemptId: proof.attemptId, keyHex: `\\x${proof.key.toString("hex")}`, method: "transaction_pin", purpose } as unknown as CoinTransferAuthorization;
  ISSUED.add(authorization);
  return { ok: true, authorization };
}

/** Is this a proof this module issued, for this member and this purpose? (Checked before anything reaches the database.) */
export function isCoinTransferAuthorized(authorization: unknown, userId: string, purpose: CoinAuthorizedAction = "transfer"): boolean {
  if (!authorization || typeof authorization !== "object" || !ISSUED.has(authorization)) return false;
  const a = authorization as CoinTransferAuthorization;
  return a.userId === userId && a.purpose === purpose;
}
