import "server-only";

import { isCoinTransferAuthorized, type CoinTransferAuthorization } from "@/lib/coin/authorization";
import { transferRulesForDb, withdrawalRulesForDb, type FrenzCoinConfig } from "@/lib/coin/config";
import { pinPolicy } from "@/lib/coin/pin";
import { COIN_WALLET_PATH, coinMemberLabel, emailCoinReceipt, notifyCoin, notifyCoinAdmins } from "@/lib/coin/notify";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

export { COIN_WALLET_PATH };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN — THE SERVER'S DOOR TO THE COIN WALLET (Frenz Coin Part 3, 0279)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Thin by design: every rule that protects money is decided in the database under the wallet locks (transfer_coins,
 * request_coin_withdrawal). This module hands the database the admin's CURRENT rules (it validates them, recomputes the
 * fees and stores them on the operation) and words its refusals. Part 4: the transfer route calls sendCoins, which
 * needs a transaction-PIN proof (Part 4.2, lib/coin/authorization.ts + 0282). Deposits live in lib/coin/deposits.ts,
 * the wallet summary and history in lib/coin/wallet.ts.
 *
 * 🔴 No fallback. If 0279 has not run, a coin call answers "not available" — it never falls back to an AI-credit
 * function, which would move the wrong product.
 */

export type CoinResult<T> = ({ ok: true } & T) | { ok: false; status: number; reason: string; error: string };

const MISSING = (m: string) => /transfer_coins|transfer_coins_with_pin|request_coin_withdrawal|frenz_coin|schema cache|does not exist/i.test(m);
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const WALLET_NUMBER = /^[1-9][0-9]{9}$/;
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const REFUSED: Record<string, [number, string]> = {
  invalid: [400, "That request isn't valid."],
  rules_invalid: [503, "Frenz Coin isn't configured correctly. Nothing was moved."],
  disabled: [503, "Frenz Coin isn't available right now."],
  amount_out_of_range: [400, "That amount is outside the allowed range."],
  no_account: [404, "No wallet has that number."],
  self: [400, "That's your own wallet."],
  no_wallet: [409, "You don't have a Frenz Coin wallet yet."],
  suspended: [403, "Coin transfers and withdrawals are paused on this account."],
  restricted: [403, "Coin transfers and withdrawals are paused on this account."],
  recovery_due: [403, "Paused while a refunded payment is settled. Contact support."],
  recipient_unavailable: [409, "That wallet can't receive coins right now."],
  daily_limit: [429, "That would pass your daily sending limit."],
  insufficient: [402, "Not enough available coins for the amount and the fee."],
  email_unconfirmed: [403, "Confirm your email address before withdrawing."],
  not_qualified: [403, "Your account isn't approved for withdrawals yet."],
  day_limit: [429, "You've reached today's withdrawal limit."],
  month_limit: [429, "That would pass this month's withdrawal limit."],
  below_fee: [400, "That amount is too small to cover the withdrawal fee."],
  open_exists: [409, "You already have a coin withdrawal in progress."],
  idempotency_conflict: [409, "That request key was already used. Try again."],
  // Part 4.2: every way a PIN can fail is ONE answer (wrong, locked, not set, an attempt already used)
  authorization_required: [403, "Confirm this transfer with your transaction PIN. Nothing was sent."],
  authorization_failed: [403, "That PIN wasn't accepted. Check it, or try again later. Nothing was sent."],
};

const refuse = (reason: string): { ok: false; status: number; reason: string; error: string } => {
  const [status, error] = REFUSED[reason] ?? [409, "That couldn't be done."];
  return { ok: false, status, reason, error };
};

/**
 * Send coins. Only with a PIN proof lib/coin/authorization.ts issued for THIS sender (checked before anything reaches the
 * database); the database then checks the PIN and runs the transfer in one transaction (0282 transfer_coins_with_pin).
 * `announce` (run it off the money path, after the response) tells the recipient once: the claim is the ledger row's
 * notified_at, so a retried request, a replay or a second announce never notifies twice, and a failed push never
 * touches the transfer.
 */
export async function sendCoins(input: { senderId: string; accountNumber: string; amountCents: number; idempotencyKey: string; note: string | null; config: FrenzCoinConfig; authorization: CoinTransferAuthorization | null }): Promise<CoinResult<{ transferId: string; amountCents: number; feeCents: number; totalCents: number; duplicate: boolean; announce: () => Promise<void> }>> {
  if (!input.config.enabled || !input.config.transfers.enabled) return refuse("disabled");
  if (!isCoinTransferAuthorized(input.authorization, input.senderId)) return refuse("authorization_required");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || !KEY.test(input.idempotencyKey) || !WALLET_NUMBER.test(input.accountNumber)) return refuse("invalid");
  const note = input.note ? input.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  const auth = input.authorization!;
  // Part 4.2 (0282): the PIN check and the transfer in ONE database transaction — the attempt is spent there, once
  const { data, error } = await createAdminClient().rpc("transfer_coins_with_pin", {
    p_sender: input.senderId,
    p_attempt: auth.attemptId,
    p_derived: auth.keyHex,
    p_account_number: input.accountNumber,
    p_amount: input.amountCents,
    p_idempotency: input.idempotencyKey,
    p_note: note,
    p_rules: transferRulesForDb(input.config),
    p_policy: pinPolicy(input.config),
  });
  if (error) {
    // never falls back to transfer_coins (0282 revoked it from every API role) or to an AI-credit transfer
    if (MISSING(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Frenz Coin transfers arrive with the next update." };
    console.error("[coin/transfer] failed", { sender: input.senderId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't send that right now. Nothing was taken." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; transfer_id?: string; recipient_id?: string; amount?: number; fee?: number; total?: number; duplicate?: boolean };
  if (!r.ok || !r.transfer_id) return refuse(r.reason ?? "error");
  const transferId = r.transfer_id;
  const amountCents = Number(r.amount);
  // a replay answers what the first request did; its announcement (if any) was the first request's
  const announce = r.duplicate || !r.recipient_id ? async () => {} : () => announceCoinTransfer({ transferId, recipientId: r.recipient_id!, senderId: input.senderId, amountCents, feeCents: Number(r.fee), totalCents: Number(r.total) });
  return { ok: true, transferId, amountCents, feeCents: Number(r.fee), totalCents: Number(r.total), duplicate: !!r.duplicate, announce };
}

/**
 * Tell the recipient once. The claim is a conditional update of the transfer's `transfer_in` ledger row (notified_at
 * null → now, allowed once by 0278's ledger guard): only the caller whose update moved it sends. Never throws.
 */
export async function announceCoinTransfer(t: { transferId: string; recipientId: string; senderId: string; amountCents: number; feeCents?: number; totalCents?: number }): Promise<void> {
  await announceToRecipient(t);
  const amount = usd(t.amountCents);
  const fee = t.feeCents ?? 0;
  const total = t.totalCents ?? t.amountCents + fee;
  // closeout: the sender's own record that it went, once (claim key), low priority — Part 5: and their receipt by email
  const to = await coinMemberPublicName(t.recipientId);
  await notifyCoin(t.senderId, `coin-transfer-out:${t.transferId}`, "coin_transfer_sent", { title: `You sent ${amount} in Frenz Coin`, body: `Your transfer of ${amount} was delivered.`, genericBody: "Your Frenz Coin transfer was delivered." }, { priority: "low", email: { subject: `You sent ${amount} in Frenz Coin`, heading: "Transfer sent", intro: `You sent ${amount} in Frenz Coin to ${to}. It was delivered.`, body: `Amount ${amount} · fee ${usd(fee)} · total taken from your wallet ${usd(total)}. Reference: ${t.transferId}` } });
  // Part 5: the admins — who sent whom how much, and the fee earned
  const [from, toAdmin] = await Promise.all([coinMemberLabel(t.senderId), coinMemberLabel(t.recipientId)]);
  await notifyCoinAdmins(`coin-transfer:${t.transferId}`, t.senderId, {
    kind: "transfer",
    title: `Coin transfer — ${amount} (fee ${usd(fee)})`,
    summary: `${from} sent ${amount} to ${toAdmin}`,
    rows: [{ label: "From", value: from }, { label: "To", value: toAdmin }, { label: "Amount", value: amount }, { label: "Total charged to sender", value: usd(total) }, { label: "Transfer", value: t.transferId }],
    feeCents: fee,
  });
}

/** A member's PUBLIC name for another member's receipt: display name or @handle — never an email or an id. */
async function coinMemberPublicName(userId: string): Promise<string> {
  const { data } = await createAdminClient().from("profiles").select("handle, display_name").eq("id", userId).maybeSingle();
  const p = data as { handle?: string | null; display_name?: string | null } | null;
  return p?.display_name || (p?.handle ? `@${p.handle}` : "a Frenz member");
}

async function announceToRecipient(t: { transferId: string; recipientId: string; senderId: string; amountCents: number }): Promise<void> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("ai_product_ledger")
      .update({ notified_at: new Date().toISOString() })
      .eq("user_id", t.recipientId)
      .eq("product", "frenz_coin")
      .eq("kind", "transfer_in")
      .eq("reference", `coin-transfer:${t.transferId}`)
      .is("notified_at", null)
      .select("id");
    if (error || !data?.length) return;
    const { data: me } = await db.from("profiles").select("handle, display_name").eq("id", t.senderId).maybeSingle();
    const p = me as { handle?: string | null; display_name?: string | null } | null;
    const who = p?.display_name || (p?.handle ? `@${p.handle}` : "A Frenz member");
    const amount = usd(t.amountCents);
    // closeout (0283): the coin's own type
    await sendSmartPush(t.recipientId, { title: `You received ${amount} in Frenz Coin`, body: `${who} sent you ${amount} in Frenz Coin.`, genericBody: "You received Frenz Coin.", url: `${SITE_URL}${COIN_WALLET_PATH}`, tag: `coin-transfer-${t.transferId}` }, "high", "premium", { type: "coin_transfer_received" });
    // Part 5: the recipient's receipt by email — under the same claim (the ledger row's notified_at), so once
    await emailCoinReceipt(t.recipientId, { subject: `You received ${amount} in Frenz Coin`, heading: "You received Frenz Coin", intro: `${who} sent you ${amount} in Frenz Coin. It's in your wallet now.`, body: `Reference: ${t.transferId}` });
  } catch (e) {
    console.warn("[coin/transfer] announce failed — the transfer stands", { transferId: t.transferId, error: e instanceof Error ? e.name : "unknown" });
  }
}

/**
 * Request a coin withdrawal. Closeout (0283): only with a PIN proof for a WITHDRAWAL issued to this member; the database
 * checks the PIN and holds the gross in one transaction (request_coin_withdrawal_with_pin) — the bare
 * request_coin_withdrawal is not callable by any API role. The fee (6% by default) comes FROM the gross.
 */
export async function requestCoinWithdrawal(input: { userId: string; grossCents: number; method: "paystack"; details: { bankCode: string; bankName: string; accountNumber: string; accountName: string }; idempotencyKey: string; config: FrenzCoinConfig; authorization: CoinTransferAuthorization | null }): Promise<CoinResult<{ id: string; grossCents: number; feeCents: number; netCents: number; duplicate: boolean }>> {
  if (!input.config.enabled || !input.config.withdrawals.enabled) return refuse("disabled");
  if (!isCoinTransferAuthorized(input.authorization, input.userId, "withdrawal")) return refuse("authorization_required");
  if (!Number.isSafeInteger(input.grossCents) || input.grossCents <= 0 || !KEY.test(input.idempotencyKey)) return refuse("invalid");
  const auth = input.authorization!;
  const { data, error } = await createAdminClient().rpc("request_coin_withdrawal_with_pin", {
    p_user: input.userId,
    p_attempt: auth.attemptId,
    p_derived: auth.keyHex,
    p_gross: input.grossCents,
    p_method: input.method,
    p_details: input.details,
    p_idempotency: input.idempotencyKey,
    p_rules: withdrawalRulesForDb(input.config),
    p_policy: pinPolicy(input.config),
  });
  if (error) {
    if (MISSING(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Frenz Coin arrives with the next update." };
    console.error("[coin/withdraw] failed", { userId: input.userId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't request that right now. Nothing was held." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; id?: string; gross?: number; fee?: number; net?: number; duplicate?: boolean };
  if (!r.ok || !r.id) {
    const out = refuse(r.reason ?? "error");
    return r.reason === "amount_out_of_range" ? { ...out, error: `Withdraw between ${usd(input.config.withdrawals.minCents)} and ${usd(input.config.withdrawals.maxCents)}.` } : out;
  }
  return { ok: true, id: r.id, grossCents: Number(r.gross), feeCents: Number(r.fee), netCents: Number(r.net), duplicate: !!r.duplicate };
}

/** The member's coin wallet: available (spendable), pending (on hold), held (reserved for a withdrawal), and the total. */
export async function coinWallet(userId: string): Promise<{ availableCents: number; pendingCents: number; heldCents: number; totalCents: number } | null> {
  const { data, error } = await createAdminClient().from("ai_product_balances").select("balance_cents, pending_cents, held_cents").eq("user_id", userId).eq("product", "frenz_coin").maybeSingle();
  if (error) return null;
  const r = data as { balance_cents: number; pending_cents: number; held_cents: number } | null;
  const b = Number(r?.balance_cents ?? 0);
  const p = Number(r?.pending_cents ?? 0);
  const h = Number(r?.held_cents ?? 0);
  return { availableCents: b - p, pendingCents: p, heldCents: h, totalCents: b + h };
}
