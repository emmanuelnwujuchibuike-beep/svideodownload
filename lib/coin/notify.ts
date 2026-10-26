import "server-only";

import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { emailMember } from "@/lib/email/member-email";
import { hasResend, sendProductEmail } from "@/lib/email/resend";
import { getLandingSettings } from "@/lib/landing/settings";
import { sendPushToUser } from "@/lib/push/web-push";
import { resolveAdminUserIds } from "@/lib/support/chat";
import type { PushPriority } from "@/lib/notifications/attention";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ COIN NOTIFICATIONS (closeout, 0283)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every coin notification is sent only AFTER the money moved (committed) and at most ONCE: a claim row in
 * coin_notification_claims, keyed by what it is about, is inserted first — only the caller whose insert lands sends.
 * A retried webhook, a second sweep, a replayed request: the claim is already there, nothing is sent. A failed send
 * never touches the money and is not retried (sending twice is the failure this exists to prevent).
 *
 *   deposit held / released   the 10-minute sweep (sweepCoinNotifications), from coin_deposits
 *   transfer received / sent  right after the transfer commits (lib/coin/server.ts announceCoinTransfer)
 *   withdrawal requested      right after the request commits (app/api/coin/withdrawals)
 *   withdrawal approved / rejected / paid / returned   the in-app row is written by the database in the SAME
 *                             transaction as the change (0283 coin_withdrawal_update); the sweep adds the push once
 *   PIN changed / reset       right after the change commits: in-app + an email to the CONFIRMED address — never the
 *                             PIN, the code, a hash or a link that does anything
 *
 * Part 5 (owner, 2026-10-25: "users and admin receive email and push of every transaction"):
 *   · every money notification above also EMAILS the member it belongs to (a receipt — kind coin_transaction, never
 *     optional), under the SAME claim as the push: once, after the commit. A member is only ever told about their own
 *     money; the other side of a transfer is named by public name/handle only.
 *   · the ADMINS hear about every transfer and withdrawal with the fee Frenz earned on it (notifyCoinAdmins), by the
 *     channel set in frenzCoin.adminAlerts (push / email / both / off), once per event (its own claim). Deposits reach
 *     the admins through the funding alerts already (lib/admin/funding-alerts.ts) — not announced twice.
 */

export type CoinNotificationType = "coin_deposit_update" | "coin_transfer_received" | "coin_transfer_sent" | "coin_withdrawal_update" | "coin_pin_security";
export const COIN_WALLET_PATH = "/wallet";
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Claim one notification. true = this caller sends it; false = already sent (or the claim could not be written). */
export async function claimCoinNotification(key: string, userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("coin_notification_claims").upsert({ key: key.slice(0, 200), user_id: userId }, { onConflict: "key", ignoreDuplicates: true }).select("key");
  if (error) {
    console.warn("[coin/notify] claim failed — not sent", { code: error.code });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Send one coin notification, once. `recorded` = the database already wrote the in-app row in the money transaction
 * (withdrawal changes): only the push is sent. Never throws.
 */
export async function notifyCoin(userId: string, key: string, type: CoinNotificationType, push: { title: string; body: string; genericBody: string }, opts: { priority?: PushPriority; recorded?: boolean; email?: CoinEmail } = {}): Promise<boolean> {
  try {
    if (!(await claimCoinNotification(key, userId))) return false;
    await sendSmartPush(userId, { ...push, url: `${SITE_URL}${COIN_WALLET_PATH}`, tag: key.slice(0, 120) }, opts.priority ?? "high", type === "coin_pin_security" ? "security" : "premium", opts.recorded ? "already-recorded" : { type });
    // Part 5: the receipt by email, under the same claim (a failed push still sends it; a failed email changes nothing)
    if (opts.email) await emailCoinReceipt(userId, opts.email);
    return true;
  } catch (e) {
    console.warn("[coin/notify] send failed — the money is unaffected", { type, error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}

/**
 * "Your transaction PIN was changed / reset": in-app, and an email to the session's CONFIRMED address. `eventKey` makes
 * it once per change (a retried response sends nothing more). Contains no PIN, code, hash or actionable link.
 */
export async function announceCoinPinChange(user: { id: string; email?: string | null; email_confirmed_at?: string | null }, via: "change" | "reset", eventKey: string): Promise<void> {
  const what = via === "reset" ? "reset with a code sent to your email" : "changed";
  const sent = await notifyCoin(user.id, `coin-pin:${via}:${eventKey}`, "coin_pin_security", { title: "Your transaction PIN was " + (via === "reset" ? "reset" : "changed"), body: `Your Frenz Coin transaction PIN was ${what}. If this wasn't you, contact support now.`, genericBody: "Your transaction PIN was updated." }, { priority: "critical" });
  if (!sent || !hasResend || !user.email_confirmed_at || !user.email?.includes("@")) return;
  try {
    const ok = await sendProductEmail(user.email, {
      subject: "Your Frenz Coin transaction PIN was " + (via === "reset" ? "reset" : "changed"),
      heading: "Transaction PIN " + (via === "reset" ? "reset" : "changed"),
      intro: `Your Frenz Coin transaction PIN was ${what} just now.`,
      body: "If you did this, there is nothing else to do. If you didn't, contact Frenz support straight away — someone may have access to your account. Frenz will never ask you for your PIN or a code.",
    });
    if (!ok) console.warn("[coin/notify] PIN security email not accepted", { userId: user.id });
  } catch {
    console.warn("[coin/notify] PIN security email failed", { userId: user.id });
  }
}

const WITHDRAWAL_PUSH: Record<string, (net: string) => { title: string; body: string }> = {
  approved: (net) => ({ title: "Withdrawal approved", body: `Your Frenz Coin withdrawal of ${net} is approved and on its way.` }),
  rejected: (net) => ({ title: "Withdrawal not completed", body: `Your Frenz Coin withdrawal of ${net} didn't go through. The coins are back in your wallet.` }),
  cancelled: (net) => ({ title: "Withdrawal cancelled", body: `Your Frenz Coin withdrawal of ${net} was cancelled. The coins are back in your wallet.` }),
  completed: (net) => ({ title: "Withdrawal paid", body: `${net} from your Frenz Coin wallet has been paid to your bank.` }),
  reversed: (net) => ({ title: "Withdrawal returned", body: `Your bank returned a Frenz Coin withdrawal of ${net}. The coins are back in your wallet.` }),
};

/**
 * The 10-minute sweep (ai-reconcile cron): deposits that landed on hold or were released, and coin withdrawals that
 * changed, in the last three days — each notified once (claims). Bounded; aggregates only.
 */
export async function sweepCoinNotifications(limit = 50): Promise<{ sent: number }> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  let sent = 0;
  const [held, released, wds] = await Promise.all([
    db.from("coin_deposits").select("reference, user_id, amount_cents, release_at").gte("settled_at", since).order("settled_at", { ascending: true }).limit(limit),
    db.from("coin_deposits").select("reference, user_id, amount_cents").eq("status", "released").gte("released_at", since).order("released_at", { ascending: true }).limit(limit),
    db.from("withdrawal_requests").select("id, user_id, status, gross_cents, fee_cents, net_cents").eq("source", "coin").in("status", Object.keys(WITHDRAWAL_PUSH)).gte("updated_at", since).order("updated_at", { ascending: true }).limit(limit),
  ]);
  for (const d of (held.data ?? []) as { reference: string; user_id: string; amount_cents: number; release_at: string }[]) {
    const when = new Date(d.release_at).toUTCString().replace(/:\d\d GMT$/, " GMT");
    const amount = usd(Number(d.amount_cents));
    if (await notifyCoin(d.user_id, `coin-deposit-held:${d.reference}`, "coin_deposit_update", { title: "Deposit received", body: `${amount} is in your Frenz Coin wallet, on hold until ${when}.`, genericBody: "Your deposit was received." }, { email: { subject: `Deposit received: ${amount} in Frenz Coin`, heading: "Deposit received", intro: `${amount} was added to your Frenz Coin wallet. It is on hold until ${when}, then you can send or withdraw it.`, body: `Reference: ${d.reference}` } })) sent++;
  }
  for (const d of (released.data ?? []) as { reference: string; user_id: string; amount_cents: number }[]) {
    const amount = usd(Number(d.amount_cents));
    if (await notifyCoin(d.user_id, `coin-deposit-released:${d.reference}`, "coin_deposit_update", { title: "Deposit available", body: `${amount} from your deposit is now available to send or withdraw.`, genericBody: "Your deposit is available." }, { priority: "medium", email: { subject: `${amount} is now available in your Frenz Coin wallet`, heading: "Deposit available", intro: `The hold on your ${amount} deposit has ended. You can now send or withdraw it.`, body: `Reference: ${d.reference}` } })) sent++;
  }
  for (const w of (wds.data ?? []) as { id: string; user_id: string; status: string; gross_cents: number; fee_cents: number; net_cents: number }[]) {
    const p = WITHDRAWAL_PUSH[w.status]!(usd(Number(w.net_cents)));
    if (await notifyCoin(w.user_id, `coin-wd:${w.id}:${w.status}`, "coin_withdrawal_update", { ...p, genericBody: "Your withdrawal was updated." }, { recorded: true, email: { subject: `${p.title}: Frenz Coin`, heading: p.title, intro: p.body, body: `Amount ${usd(Number(w.gross_cents))} · fee ${usd(Number(w.fee_cents))} · paid to you ${usd(Number(w.net_cents))}. Reference: ${w.id}` } })) sent++;
    // the admins: when one is PAID (the fee is earned) or RETURNED by the bank (the coins went back)
    if (w.status === "completed" || w.status === "reversed") {
      const who = await coinMemberLabel(w.user_id);
      const paid = w.status === "completed";
      await notifyCoinAdmins(`coin-wd:${w.id}:${w.status}`, w.user_id, {
        kind: paid ? "withdrawal_paid" : "withdrawal_returned",
        title: paid ? `Coin withdrawal paid — ${usd(Number(w.net_cents))}` : `Coin withdrawal returned by the bank — ${usd(Number(w.net_cents))}`,
        summary: paid ? `${who} was paid ${usd(Number(w.net_cents))} from ${usd(Number(w.gross_cents))}` : `The withdrawal of ${who} came back; the coins were returned to their wallet`,
        rows: [{ label: "Member", value: who }, { label: "Amount", value: usd(Number(w.gross_cents)) }, { label: "Paid to member", value: usd(Number(w.net_cents)) }, { label: "Withdrawal", value: w.id }],
        feeCents: paid ? Number(w.fee_cents) : 0,
      });
    }
  }
  return { sent };
}

// ── Part 5: receipts by email, and the admins' alerts ────────────────────────

export type CoinEmail = { subject: string; heading: string; intro: string; body?: string };

/** A coin receipt to the member's own address (profiles.email). Never throws; the money is never affected. */
export async function emailCoinReceipt(userId: string, e: CoinEmail): Promise<void> {
  try {
    await emailMember(userId, { ...e, ctaLabel: "Open your wallet", ctaPath: COIN_WALLET_PATH }, "coin_transaction");
  } catch {
    console.warn("[coin/notify] receipt email failed — the money is unaffected", { userId });
  }
}

export type CoinAdminAlert = { kind: "transfer" | "withdrawal_requested" | "withdrawal_paid" | "withdrawal_returned"; title: string; summary: string; rows: { label: string; value: string }[]; feeCents: number };

/**
 * Tell the ADMINS about one coin transaction and the fee Frenz earned on it (owner, 2026-10-25: "admin should get an
 * additional push or email … the profit which is the fees and percentage"). The channel is frenzCoin.adminAlerts.
 * Once per event: a claim keyed `admin:<key>` (the owner of the transaction is the claim's member). Never throws.
 */
export async function notifyCoinAdmins(key: string, ownerId: string, alert: CoinAdminAlert): Promise<boolean> {
  try {
    const channel = (await getLandingSettings()).frenzCoin.adminAlerts;
    if (channel === "off") return false;
    if (!(await claimCoinNotification(`admin:${key}`, ownerId))) return false;
    const fee = usd(alert.feeCents);
    if (channel === "push" || channel === "both") {
      const admins = await resolveAdminUserIds().catch(() => [] as string[]);
      await Promise.allSettled(admins.map((id) => sendPushToUser(id, { title: alert.title, body: `${alert.summary} · fee earned ${fee}`, url: "/admin#revenue", tag: `coin-admin:${key}`.slice(0, 120) })));
    }
    if (channel === "email" || channel === "both") {
      await sendAdminEmail(alert.title, alertEmailHtml({ heading: alert.title, intro: alert.summary, rows: [...alert.rows, { label: "Fee earned (Frenz)", value: fee }] }));
    }
    return true;
  } catch (e) {
    console.warn("[coin/notify] admin alert failed — the money is unaffected", { kind: alert.kind, error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}

/** "Name (@handle)" for an admin alert — admins see who; members never see anyone else's transactions. */
export async function coinMemberLabel(userId: string): Promise<string> {
  const { data } = await createAdminClient().from("profiles").select("handle, display_name").eq("id", userId).maybeSingle();
  const p = data as { handle?: string | null; display_name?: string | null } | null;
  const name = p?.display_name || "A member";
  return p?.handle ? `${name} (@${p.handle})` : name;
}
