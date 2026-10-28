import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Message requests by push and email (0295, owner 2026-10-27: "receive messages request through push and email when
 * someone who they don't follow or friends with send them a message but without showing the message, just the request
 * push or email, depends on which the users switch on").
 *
 * ── What counts as a request ────────────────────────────────────────────────
 * A one-to-one chat (direct or secret) where the RECIPIENT does not follow the sender, they are not friends, and the
 * recipient has never sent a message in it. Decided per message at send time, so following, befriending or replying
 * turns the chat into an ordinary one from the next message on. A read error counts as a request: that only HIDES
 * content, it never shows a stranger's words.
 *
 * ── What is sent ────────────────────────────────────────────────────────────
 * The sender's public name and "wants to send you a message". Never the message, an attachment name or a preview —
 * for that recipient the ordinary message push and email are not sent at all (app/api/messages/route.ts).
 * Once per chat: the first request message claims message_request_notices; later ones from the same stranger are
 * quiet until the recipient answers (then they are normal messages, with their own notifications).
 *
 * ── The switches ────────────────────────────────────────────────────────────
 * notification_settings.message_request_push / message_request_email — independent, on by default, read at send
 * time. Push goes through sendSmartPush (master / push switches, quiet hours, delivery rules still apply; with the
 * switch off it is recorded in-app only). Email is OPTIONAL email (kind message_request), so the global optional-email
 * switch silences it too.
 */
type Db = ReturnType<typeof createAdminClient>;

export interface MessageRequestPrefs {
  push: boolean;
  email: boolean;
}

export const DEFAULT_MESSAGE_REQUEST_PREFS: MessageRequestPrefs = { push: true, email: true };

const MISSING = (m: string) => /message_request|column|schema cache|does not exist/i.test(m);

export async function getMessageRequestPrefs(userId: string, db: Db = createAdminClient()): Promise<MessageRequestPrefs & { ready: boolean }> {
  try {
    const { data, error } = await db.from("notification_settings").select("message_request_push, message_request_email").eq("user_id", userId).maybeSingle();
    if (error) return { ...DEFAULT_MESSAGE_REQUEST_PREFS, ready: !MISSING(error.message) };
    const r = data as { message_request_push?: unknown; message_request_email?: unknown } | null;
    return { push: r?.message_request_push !== false, email: r?.message_request_email !== false, ready: true };
  } catch {
    return { ...DEFAULT_MESSAGE_REQUEST_PREFS, ready: true };
  }
}

/** Save the given switch(es) on the member's own row (the route passes the session user). Only what was sent is written. */
export async function setMessageRequestPrefs(userId: string, patch: Partial<MessageRequestPrefs>): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
  if (typeof patch.push === "boolean") row.message_request_push = patch.push;
  if (typeof patch.email === "boolean") row.message_request_email = patch.email;
  if (!("message_request_push" in row) && !("message_request_email" in row)) return { ok: false, status: 400, error: "Nothing to save." };
  const { error } = await createAdminClient().from("notification_settings").upsert(row, { onConflict: "user_id" });
  if (!error) return { ok: true };
  return MISSING(error.message) ? { ok: false, status: 503, error: "Message request settings arrive with the next update." } : { ok: false, status: 500, error: "Couldn't save." };
}

/** Is this message, to this recipient, a message request? See the header for the rule. */
export async function isMessageRequest(db: Db, input: { recipientId: string; senderId: string; conversationId: string; conversationType: string | null | undefined }): Promise<boolean> {
  const type = input.conversationType ?? "direct";
  if (type !== "direct" && type !== "secret") return false;
  const [low, high] = input.recipientId < input.senderId ? [input.recipientId, input.senderId] : [input.senderId, input.recipientId];
  const [follows, friends, replied] = await Promise.all([
    db.from("follows").select("follower_id").eq("follower_id", input.recipientId).eq("following_id", input.senderId).limit(1),
    db.from("friendships").select("user_low").eq("user_low", low).eq("user_high", high).limit(1),
    db.from("messages").select("id").eq("conversation_id", input.conversationId).eq("sender_id", input.recipientId).limit(1),
  ]);
  // an unreadable answer is treated as a request: it can only hide content, never reveal it
  if (follows.error || friends.error || replied.error) return true;
  return (follows.data ?? []).length === 0 && (friends.data ?? []).length === 0 && (replied.data ?? []).length === 0;
}

export type MessageRequestOutcome = { claimed: false } | { claimed: true; push: string; email: string };

/**
 * Announce a request to one recipient — once per chat. Returns what happened, for the tests and logs; the caller has
 * already left the ordinary message notifications out for this recipient.
 */
export async function notifyMessageRequest(
  db: Db,
  input: { recipientId: string; senderId: string; conversationId: string; conversationType: string | null | undefined; sender: { name: string; handle: string | null; avatarUrl: string | null } },
): Promise<MessageRequestOutcome> {
  // claim the chat first: the insert succeeds for exactly one caller, ever
  const claim = await db.from("message_request_notices").insert({ user_id: input.recipientId, conversation_id: input.conversationId, sender_id: input.senderId }).select("user_id");
  if (claim.error || (claim.data ?? []).length === 0) return { claimed: false };

  const prefs = await getMessageRequestPrefs(input.recipientId, db);
  const path = input.conversationType === "secret" ? `/messages/secret/${input.conversationId}` : `/messages/${input.conversationId}`;
  const line = `${input.sender.name} wants to send you a message`;

  const [push, email] = await Promise.all([
    sendSmartPush(
      input.recipientId,
      { title: "New message request", body: line, genericBody: "You have a new message request", url: path, icon: input.sender.avatarUrl ?? undefined, tag: `msgreq:${input.conversationId}`, conversationId: input.conversationId },
      "high",
      "social",
      // the in-app row (lib/social/messages.ts) already exists and carries no content; the decision is stamped on it
      { recorded: { type: "message", conversationId: input.conversationId, actorId: input.senderId } },
      { push: prefs.push },
    )
      .then((o) => (prefs.push ? o.decision : "preference_off"))
      .catch(() => "failed"),
    prefs.email
      ? emailMember(
          input.recipientId,
          {
            subject: "New message request on Frenzsave",
            heading: "You have a new message request",
            intro: `${line}. Open the request to see it and choose whether to reply.`,
            ctaLabel: "See the request",
            ctaPath: path,
            person: input.sender,
            settingsPath: "/account/notifications",
          },
          "message_request").catch(() => "failed")
      : Promise.resolve("preference_off"),
  ]);
  return { claimed: true, push, email };
}
