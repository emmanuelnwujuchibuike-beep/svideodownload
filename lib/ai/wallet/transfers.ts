import "server-only";

import { transferFee, type CreditTransferConfig } from "@/lib/ai/credits/wallet-config";
import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CREDIT TRANSFERS — send credits to a member's wallet number (0193)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07. Internal on purpose: credits exist only in our ledger, so
 * a transfer is one SQL transaction (`transfer_credits`) — instant, no provider
 * fee. The browser names a wallet number, an amount, an idempotency key and an
 * optional note; the fee, the bounds, the balance and the classes are the
 * server's. The recipient is told by push at once, and an open wallet sees the
 * new balance through realtime (0193 publication).
 */
export const WALLET_NUMBER_RE = /^[1-9][0-9]{9}$/;

export async function getWalletNumber(userId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("ensure_wallet_number", { p_user: userId });
  if (error) {
    console.error("[wallet/transfer] wallet number failed", { userId, message: error.message });
    return null;
  }
  return typeof data === "string" ? data : null;
}

/** Who a wallet number belongs to — shown to the sender to confirm before sending. Never an email. */
export async function lookupWallet(number: string, viewerId: string): Promise<{ ok: true; name: string; handle: string | null; avatarUrl: string | null } | { ok: false; reason: "invalid" | "not_found" | "self" }> {
  if (!WALLET_NUMBER_RE.test(number)) return { ok: false, reason: "invalid" };
  const db = createAdminClient();
  const { data } = await db.from("wallet_accounts").select("user_id").eq("account_number", number).maybeSingle();
  const userId = (data as { user_id?: string } | null)?.user_id;
  if (!userId) return { ok: false, reason: "not_found" };
  if (userId === viewerId) return { ok: false, reason: "self" };
  const { data: p } = await db.from("profiles").select("handle, display_name, avatar_url").eq("id", userId).maybeSingle();
  const prof = p as { handle: string | null; display_name: string | null; avatar_url: string | null } | null;
  return { ok: true, name: prof?.display_name || (prof?.handle ? `@${prof.handle}` : "Frenz member"), handle: prof?.handle ?? null, avatarUrl: prof?.avatar_url ?? null };
}

/**
 * Which credits a transfer moves (0199, owner 2026-10-08). The recipient gets the
 * SAME kind: non-withdrawable stays non-withdrawable even for a member approved
 * for withdrawals; withdrawable stays withdrawable. The fee comes from the same kind.
 */
export type CreditKind = "usable" | "withdrawable";

export type TransferResult =
  | { ok: true; transferId: string; amount: number; fee: number; balanceAfter: number | null; duplicate: boolean; creditClass: CreditKind }
  | { ok: false; status: number; error: string; reason?: string };

export async function sendCredits(input: { senderId: string; accountNumber: string; credits: number; idempotencyKey: string; note: string | null; config: CreditTransferConfig; creditClass?: CreditKind }): Promise<TransferResult> {
  const kind: CreditKind = input.creditClass === "withdrawable" ? "withdrawable" : "usable";
  const kindWord = kind === "withdrawable" ? "withdrawable credits" : "non-withdrawable credits";
  const c = input.config;
  if (!c.enabled) return { ok: false, status: 503, error: "Credit transfers aren't available right now." };
  if (!WALLET_NUMBER_RE.test(input.accountNumber)) return { ok: false, status: 400, error: "Enter a 10-digit wallet number." };
  const amount = Math.floor(input.credits);
  if (!Number.isFinite(amount) || amount < c.minCredits || amount > c.maxCredits) {
    return { ok: false, status: 400, error: `Send between ${c.minCredits.toLocaleString("en-US")} and ${c.maxCredits.toLocaleString("en-US")} credits.` };
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) return { ok: false, status: 400, error: "Invalid request." };
  const db = createAdminClient();
  // the rolling 24-hour limit (amounts sent, not fees)
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent } = await db.from("credit_transfers").select("amount").eq("sender_id", input.senderId).gte("created_at", since).limit(1000);
  const sent = ((recent ?? []) as { amount: number }[]).reduce((a, r) => a + r.amount, 0);
  if (sent + amount > c.dailyMaxCredits) return { ok: false, status: 429, error: `That would pass the daily limit of ${c.dailyMaxCredits.toLocaleString("en-US")} credits.` };

  const fee = transferFee(amount, c.feePercent);
  const note = input.note ? input.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || null : null;
  const { data, error } = await db.rpc("transfer_credits", { p_sender: input.senderId, p_account_number: input.accountNumber, p_amount: amount, p_fee: fee, p_idempotency: input.idempotencyKey, p_note: note, p_class: kind });
  if (error) {
    console.error("[wallet/transfer] failed", { sender: input.senderId, message: error.message });
    return { ok: false, status: 503, error: "Couldn't send that right now. Nothing was taken." };
  }
  const out = data as { ok: boolean; reason?: string; transfer_id?: string; amount?: number; fee?: number; balance_after?: number; recipient_id?: string; duplicate?: boolean; balance?: number; needed?: number };
  if (!out.ok) {
    const map: Record<string, [number, string]> = {
      no_account: [404, "No wallet has that number."],
      self: [400, "That's your own wallet number."],
      restricted: [403, "Transfers are paused on this account."],
      insufficient: [402, `Not enough ${kindWord} — this needs ${Number(out.needed ?? amount + fee).toLocaleString("en-US")} (${amount.toLocaleString("en-US")} + ${fee.toLocaleString("en-US")} fee) and you have ${Number((out as { available?: number }).available ?? 0).toLocaleString("en-US")}.`],
      no_wallet: [409, "That wallet can't receive credits yet."],
    };
    const [status, error] = map[out.reason ?? ""] ?? [400, "That transfer couldn't be made."];
    return { ok: false, status, error, reason: out.reason };
  }
  if (!out.duplicate && out.recipient_id) {
    const recipientId = out.recipient_id;
    const { data: me } = await db.from("profiles").select("handle, display_name").eq("id", input.senderId).maybeSingle();
    const who = (me as { handle?: string | null; display_name?: string | null } | null)?.display_name || ((me as { handle?: string | null } | null)?.handle ? `@${(me as { handle: string }).handle}` : "A Frenz member");
    await sendSmartPush(
      recipientId,
      { title: `You received ${amount.toLocaleString("en-US")} ${kindWord}`, body: `${who} sent you ${amount.toLocaleString("en-US")} ${kindWord}.${note ? ` “${note}”` : ""}`, url: `${SITE_URL}/ai/usage`, genericBody: "You received AI credits.", tag: `transfer-${out.transfer_id}` },
      "high",
      "premium",
      { type: "ai_deposit_successful" },
    ).catch(() => {});
    // 2026-10-07 (owner: "let users receive email"): the recipient is emailed too
    await emailMember(recipientId, {
      subject: `You received ${amount.toLocaleString("en-US")} ${kindWord}`,
      heading: `You received ${amount.toLocaleString("en-US")} ${kindWord}`,
      intro: `${who} sent you ${amount.toLocaleString("en-US")} ${kindWord} on Frenzsave. They are in your wallet now${kind === "withdrawable" ? " and can be cashed out" : " and can be used for Frenz AI, but not withdrawn"}.`,
      body: note ?? undefined,
      ctaLabel: "Open your wallet",
      ctaPath: "/ai/usage",
    });
    console.info("[wallet/transfer] sent", { sender: input.senderId, recipient: recipientId, amount, fee });
  }
  return { ok: true, transferId: String(out.transfer_id), amount: Number(out.amount ?? amount), fee: Number(out.fee ?? fee), balanceAfter: out.balance_after ?? null, duplicate: !!out.duplicate, creditClass: ((out as { credit_class?: string }).credit_class === "withdrawable" ? "withdrawable" : "usable") };
}
