import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { getGiftNotifyPrefs } from "@/lib/gift/notify-prefs";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "YOU RECEIVED A STICKER GIFT" — PUSH AND EMAIL (Frenz Gift Coin Part 4.1, 0294)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The gift commits first (send_gift_with_pin). Its two outbox rows (gift_notifications: push, email) are written by a
 * trigger in the SAME transaction, so a committed gift always has them and a failed gift never does. Then, AFTER the
 * response (next/server `after`), dispatchGiftNotifications sends each channel once:
 *
 *   claim_gift_notification   one caller wins the row (pending, a failure with attempts left, or a stale claim); a
 *                             gift reversed before this point is skipped, never announced as received
 *   the member's switch       gift_push / gift_email (0294) — independent; off = skipped (preference_off)
 *   the global controls       push: sendSmartPush (master / push switches, the premium category, quiet hours, delivery
 *                             rules, lock-screen privacy, the member's devices and their pruning). Email: emailMember
 *                             with kind gift_received (OPTIONAL email: the global optional-email switch, the account's
 *                             own address, escaping, one-click unsubscribe), plus a link to the settings screen
 *   finish_gift_notification  sent (the push service / Resend ACCEPTED it) | skipped (a switch or rule said no, no device,
 *                             no address) | failed (refused — retried by the 10-minute reconcile sweep, at most 3 tries)
 *
 * Nothing here can touch the gift: every failure is caught and recorded. A replayed gift request dispatches again and
 * finds its rows already sent, so nothing is sent twice. Logs carry the gift id and a reason code, never a name, an
 * address or a token. The in-app record is the gift message in the chat (always there), so the push is not recorded
 * again in the bell.
 */

export type GiftChannel = "push" | "email";
// batch_index / batch_size: 0296 — several copies sent in one action are announced ONCE, on the first (absent before 0296 = 1)
type Claim = { ok: true; gift_id: string; recipient_id: string; sender_id: string; conversation_id: string; sticker_name: string | null; batch_index?: number; batch_size?: number } | { ok: false; reason: string };
export type DispatchOutcome = "sent" | "skipped" | "failed" | "not_due";

const SETTINGS_PATH = "/account/notifications";

async function senderPublic(senderId: string): Promise<{ name: string; handle: string | null; avatarUrl: string | null }> {
  const { data } = await createAdminClient().from("profiles").select("display_name, handle, avatar_url").eq("id", senderId).maybeSingle();
  const p = data as { display_name?: string | null; handle?: string | null; avatar_url?: string | null } | null;
  const name = (p?.display_name || (p?.handle ? `@${p.handle}` : "") || "Someone").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60);
  return { name, handle: p?.handle ?? null, avatarUrl: p?.avatar_url ?? null };
}

async function finish(giftId: string, channel: GiftChannel, status: "sent" | "skipped" | "failed", reason: string | null): Promise<void> {
  const { error } = await createAdminClient().rpc("finish_gift_notification", { p_gift: giftId, p_channel: channel, p_status: status, p_reason: reason });
  if (error) console.warn("[gift/notify] outcome not recorded", { giftId, channel, status, code: error.code });
}

/** One channel of one gift: claimed, decided, sent, recorded. Never throws. */
export async function dispatchGiftChannel(giftId: string, channel: GiftChannel): Promise<DispatchOutcome> {
  let claimed = false;
  try {
    const { data, error } = await createAdminClient().rpc("claim_gift_notification", { p_gift: giftId, p_channel: channel });
    if (error) {
      console.warn("[gift/notify] claim failed", { giftId, channel, code: error.code });
      return "not_due";
    }
    const c = (data ?? { ok: false, reason: "invalid" }) as Claim;
    if (!c.ok) return c.reason === "reversed" ? "skipped" : "not_due";
    claimed = true;
    // Part 6 (0296): a copy after the first in its batch is part of the first one's announcement — closed, not sent
    if ((c.batch_index ?? 1) > 1) {
      await finish(giftId, channel, "skipped", "batched");
      return "skipped";
    }
    const count = Math.max(1, Math.trunc(c.batch_size ?? 1));
    const prefs = await getGiftNotifyPrefs(c.recipient_id);
    const sender = await senderPublic(c.sender_id);
    const sticker = (c.sticker_name ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 60) || "a sticker";
    const chatPath = `/messages/${c.conversation_id}`;

    if (channel === "push") {
      if (!prefs.push) {
        await finish(giftId, channel, "skipped", "preference_off");
        return "skipped";
      }
      const out = await sendSmartPush(
        c.recipient_id,
        { title: count > 1 ? "Sticker gifts received" : "Sticker gift received", body: count > 1 ? `You received ${count} sticker gifts from ${sender.name}: ${sticker}` : `You received a sticker gift from ${sender.name}: ${sticker}`, genericBody: count > 1 ? "You received sticker gifts." : "You received a sticker gift.", url: `${SITE_URL}${chatPath}`, tag: `gift:${giftId}`.slice(0, 120), actorId: c.sender_id },
        "high",
        "premium",
        "already-recorded",
      );
      if (out.decision !== "push") {
        await finish(giftId, channel, "skipped", (out.reasons[0] ?? "not_pushed").toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 40) || "not_pushed");
        return "skipped";
      }
      if (out.devices === 0) {
        await finish(giftId, channel, "skipped", "no_devices");
        return "skipped";
      }
      if (out.accepted > 0) {
        await finish(giftId, channel, "sent", null);
        return "sent";
      }
      await finish(giftId, channel, "failed", "push_refused");
      return "failed";
    }

    if (!prefs.email) {
      await finish(giftId, channel, "skipped", "preference_off");
      return "skipped";
    }
    const result = await emailMember(
      c.recipient_id,
      {
        subject: "You received a sticker gift on Frenzsave",
        heading: "You received a sticker gift",
        // never the sender's note: it is in the chat only (0296)
        intro: count > 1 ? `${sender.name} sent you ${count} sticker gifts: ${sticker}.` : `${sender.name} sent you a sticker gift: ${sticker}.`,
        body: "Open the chat to see it. Your share of the gift appears in your Gift Coin wallet and becomes available after its hold. To stop these emails, turn off Gift emails in your notification settings.",
        ctaLabel: "Open the chat",
        ctaPath: chatPath,
        person: sender,
        settingsPath: SETTINGS_PATH,
      },
      "gift_received");
    await finish(giftId, channel, result, result === "skipped" ? "not_eligible" : result === "failed" ? "email_refused" : null);
    return result;
  } catch (e) {
    console.warn("[gift/notify] dispatch failed — the gift is unaffected", { giftId, channel, error: e instanceof Error ? e.name : "unknown" });
    if (claimed) await finish(giftId, channel, "failed", "error").catch(() => undefined);
    return "failed";
  }
}

/** Both channels of a gift (after the gift committed). Independent: one channel's outcome never affects the other. */
export async function dispatchGiftNotifications(giftId: string): Promise<{ push: DispatchOutcome; email: DispatchOutcome }> {
  const [push, email] = await Promise.all([dispatchGiftChannel(giftId, "push"), dispatchGiftChannel(giftId, "email")]);
  return { push, email };
}

/**
 * Part 6 (0296): a batch — the first gift announces it (with the count), then every other copy's rows are closed as
 * "batched". In that order, so the announcement is never held up by the bookkeeping. Each row is still claimed and
 * finished exactly once; a copy the sweep reaches first is closed the same way (dispatchGiftChannel checks the batch).
 */
export async function dispatchGiftBatchNotifications(giftIds: string[]): Promise<{ push: DispatchOutcome; email: DispatchOutcome } | null> {
  const [first, ...rest] = giftIds;
  if (!first) return null;
  const out = await dispatchGiftNotifications(first);
  for (const id of rest) await dispatchGiftNotifications(id);
  return out;
}

/** The 10-minute reconcile sweep: notifications the after-response dispatch never reached, retries, stale claims. */
export async function sweepGiftNotifications(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  try {
    const { data, error } = await createAdminClient().rpc("due_gift_notifications", { p_limit: limit });
    if (error) return out;
    for (const row of (Array.isArray(data) ? data : []) as { gift_id: string; channel: GiftChannel }[]) {
      const r = await dispatchGiftChannel(row.gift_id, row.channel);
      if (r === "sent") out.sent++;
      else if (r === "failed") out.failed++;
      else if (r === "skipped") out.skipped++;
    }
  } catch {
    /* not yet migrated, or transient: the next sweep tries again */
  }
  return out;
}
