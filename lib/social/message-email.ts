import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * New-message email (0262, owner 2026-10-18: "Users should receive messages through email and push but
 * they can turn off email notification in chat if they have installed the app to use push").
 *
 * ── When a message emails someone ──────────────────────────────────────────
 * Sent from the same after() step as the push (app/api/messages/route.ts) — no timer, no cron, nothing
 * running while nobody is chatting. A recipient is emailed only when ALL hold:
 *  · direct and secret chats always; a group chat only when they are @mentioned (group chatter by
 *    email would bury them)
 *  · their message-email switch is on (default) AND their global optional-email switch is on (0253 —
 *    emailMember checks it at send time; this is OPTIONAL email, with one-click unsubscribe)
 *  · they have not read this chat in the last ACTIVE_MS — someone in the chat right now has push and
 *    the open thread, and an email on top is noise
 *  · this chat has not emailed them since they last read it, and not within MIN_GAP_MS — one email per
 *    batch of unread messages, never one per message
 *
 * ── Turning it off needs push ──────────────────────────────────────────────
 * Off is allowed only while the member has a push subscription on some device (the installed app with
 * notifications on), so nobody can switch off the one channel that reaches them with the app closed.
 *
 * Fails closed for sending (a read error sends nothing) and best-effort overall: email is never in the
 * way of the message itself.
 */

type Db = ReturnType<typeof createAdminClient>;
const ACTIVE_MS = 10 * 60_000;
const MIN_GAP_MS = 60 * 60_000;
const MISSING = (m: string) => /message_email|column|schema cache|does not exist/i.test(m);

export interface MessageEmailSetting {
  /** email me new messages */
  on: boolean;
  /** the member has push on at least one device, so they may turn email off */
  hasPush: boolean;
  /** false before 0262 runs */
  ready: boolean;
}

async function hasPushDevice(userId: string, db: Db): Promise<boolean> {
  const { data, error } = await db.from("push_subscriptions").select("id").eq("user_id", userId).limit(1);
  return !error && (data ?? []).length > 0;
}

export async function getMessageEmailSetting(userId: string, db: Db = createAdminClient()): Promise<MessageEmailSetting> {
  const [row, hasPush] = await Promise.all([db.from("notification_settings").select("message_email").eq("user_id", userId).maybeSingle(), hasPushDevice(userId, db)]);
  if (row.error) return { on: true, hasPush, ready: !MISSING(row.error.message) };
  return { on: (row.data as { message_email?: unknown } | null)?.message_email !== false, hasPush, ready: true };
}

/** The member's OWN switch (the caller passes the session user). Off only with push on a device. */
export async function setMessageEmail(userId: string, on: boolean, db: Db = createAdminClient()): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!on && !(await hasPushDevice(userId, db))) {
    return { ok: false, error: "Install the app and turn on notifications first, so new messages still reach you.", status: 409 };
  }
  const { error } = await db.from("notification_settings").upsert({ user_id: userId, message_email: on, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (!error) return { ok: true };
  return MISSING(error.message) ? { ok: false, error: "Message email arrives with the next update.", status: 503 } : { ok: false, error: "Couldn't save.", status: 500 };
}

/** When the recipient last read this chat: their group cursor, or the latest message to them they've read. */
async function lastReadAt(db: Db, conversationId: string, userId: string, direct: boolean): Promise<number> {
  if (direct) {
    const { data } = await db.from("messages").select("read_at").eq("conversation_id", conversationId).neq("sender_id", userId).not("read_at", "is", null).order("read_at", { ascending: false }).limit(1);
    const t = (data as { read_at: string }[] | null)?.[0]?.read_at;
    return t ? Date.parse(t) : 0;
  }
  const { data } = await db.from("conversation_members").select("last_read_at").eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
  const t = (data as { last_read_at: string | null } | null)?.last_read_at;
  return t ? Date.parse(t) : 0;
}

/** Decides from the times alone — pure, so the rule is tested without a database. */
export function shouldEmail(input: { now: number; lastReadAt: number; lastEmailAt: number }): boolean {
  const { now, lastReadAt, lastEmailAt } = input;
  if (now - lastReadAt < ACTIVE_MS) return false; // in the chat right now
  if (lastEmailAt > lastReadAt) return false; // already emailed about this unread batch
  if (now - lastEmailAt < MIN_GAP_MS) return false; // and never more than once an hour
  return true;
}

export async function emailNewMessage(input: {
  senderName: string;
  senderHandle: string | null;
  senderAvatarUrl: string | null;
  conversationId: string;
  conversationType: string | null | undefined;
  recipientIds: string[];
  mentionedIds: Set<string>;
  /** the push preview — never ciphertext; a secret chat passes the generic label */
  preview: string;
}): Promise<void> {
  const db = createAdminClient();
  const type = input.conversationType ?? "direct";
  const direct = type === "direct" || type === "secret";
  const targets = direct ? input.recipientIds : input.recipientIds.filter((id) => input.mentionedIds.has(id));
  if (!targets.length) return;
  // who has message email on (missing row = on); a failed read sends nothing
  const prefs = await db.from("notification_settings").select("user_id, message_email, hide_push_preview").in("user_id", targets);
  if (prefs.error && !MISSING(prefs.error.message)) return;
  const rows = new Map(((prefs.data ?? []) as { user_id: string; message_email?: boolean; hide_push_preview?: boolean }[]).map((r) => [r.user_id, r]));
  const now = Date.now();
  await Promise.all(
    targets
      .filter((id) => rows.get(id)?.message_email !== false)
      .map(async (userId) => {
        const [read, sent] = await Promise.all([
          lastReadAt(db, input.conversationId, userId, direct),
          db.from("message_email_sends").select("sent_at").eq("user_id", userId).eq("conversation_id", input.conversationId).maybeSingle(),
        ]);
        if (sent.error) return; // before 0262, or a failed read: no email on a guess
        const lastEmailAt = (sent.data as { sent_at: string } | null)?.sent_at ? Date.parse((sent.data as { sent_at: string }).sent_at) : 0;
        if (!shouldEmail({ now, lastReadAt: read, lastEmailAt })) return;
        // claim the slot first, so two messages a moment apart can't both email
        const claim = await db.from("message_email_sends").upsert({ user_id: userId, conversation_id: input.conversationId, sent_at: new Date(now).toISOString() }, { onConflict: "user_id,conversation_id" });
        if (claim.error) return;
        const mentioned = !direct;
        const hidden = rows.get(userId)?.hide_push_preview === true || type === "secret";
        await emailMember(
          userId,
          {
            subject: mentioned ? `${input.senderName} mentioned you` : `New message from ${input.senderName}`,
            heading: mentioned ? `${input.senderName} mentioned you` : `${input.senderName} sent you a message`,
            intro: hidden ? "Open Frenz to read it." : input.preview,
            ctaLabel: "Open the chat",
            ctaPath: type === "secret" ? `/messages/secret/${input.conversationId}` : `/messages/${input.conversationId}`,
            person: { name: input.senderName, handle: input.senderHandle, avatarUrl: input.senderAvatarUrl },
          },
          "new_message");
      }),
  );
}
