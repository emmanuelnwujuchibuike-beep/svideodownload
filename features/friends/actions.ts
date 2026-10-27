"use server";

import { after } from "next/server";
import { z } from "zod";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { assistantLimiter } from "@/lib/rate-limit";
import { friendErrorFor } from "@/lib/social/friend-requests/errors";
import { cancelFriendRequest, friendshipState, sendFriendRequest } from "@/lib/social/friends";
import { getOrCreateConversation, sendMessage } from "@/lib/social/messages";
import { bumpSuggestionVersion } from "@/lib/social/people/engine";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The Friends page's mutations (Friends redesign, 2026-10-26): Add, Undo, Skip, Undo skip and Say hi,
 * as Server Actions the buttons call inside a transition (useOptimistic draws the answer first, a
 * refusal rolls it back with the message returned here). Each one does exactly what the API route it
 * mirrors does — the same library calls, the same refusal words (lib/social/friend-requests/errors).
 * Nothing here is read on page load: an action runs only on a tap.
 */

export type FriendActionOutcome = { ok: true; conversationId?: string } | { ok: false; error: string };

const id = z.string().uuid();
const SNOOZE_DAYS = 7;

async function viewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Add friend from a suggestion — POST /api/friends/:id { action: "request", source: "suggestion" }. */
export async function addFriendAction(personId: string): Promise<FriendActionOutcome> {
  if (!id.safeParse(personId).success) return { ok: false, error: "Couldn't send that request." };
  const { user } = await viewer();
  if (!user) return { ok: false, error: "Sign in to add friends." };
  const { success } = await assistantLimiter.limit(`friend:${user.id}`);
  if (!success) return { ok: false, error: "Slow down a little and try again." };
  const res = await sendFriendRequest(user.id, personId, null, "suggestion");
  if (!res.ok) return { ok: false, error: friendErrorFor(res.reason).msg };
  await Promise.all([bumpSuggestionVersion(user.id), bumpSuggestionVersion(personId)]);
  return { ok: true };
}

/** Undo / "Requested" tapped — takes back a pending request. Never unfriends (that stays two taps in the friend's menu). */
export async function cancelFriendAction(personId: string): Promise<FriendActionOutcome> {
  if (!id.safeParse(personId).success) return { ok: false, error: "Couldn't undo that." };
  const { user } = await viewer();
  if (!user) return { ok: false, error: "Sign in first." };
  if ((await friendshipState(user.id, personId)) === "friends") return { ok: false, error: "You're already friends." };
  const res = await cancelFriendRequest(user.id, personId);
  if (!res.ok) return { ok: false, error: "Couldn't undo that request." };
  await Promise.all([bumpSuggestionVersion(user.id), bumpSuggestionVersion(personId)]);
  return { ok: true };
}

/** Skip — "remind me later": hidden from suggestions for a week (people_suggestion_feedback, private by RLS). */
export async function skipSuggestionAction(personId: string): Promise<FriendActionOutcome> {
  const { supabase, user } = await viewer();
  if (!user || !id.safeParse(personId).success || personId === user.id) return { ok: false, error: "Couldn't skip." };
  const { error } = await supabase.from("people_suggestion_feedback").upsert(
    {
      viewer_id: user.id,
      subject_id: personId,
      action: "later",
      snooze_until: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString(),
      created_at: new Date().toISOString(),
    },
    { onConflict: "viewer_id,subject_id" },
  );
  if (error) return { ok: false, error: "Couldn't skip right now." };
  await bumpSuggestionVersion(user.id);
  return { ok: true };
}

/** Undo a skip — forgets that one answer. */
export async function unskipSuggestionAction(personId: string): Promise<FriendActionOutcome> {
  const { supabase, user } = await viewer();
  if (!user || !id.safeParse(personId).success) return { ok: false, error: "Couldn't undo." };
  const { error } = await supabase.from("people_suggestion_feedback").delete().eq("viewer_id", user.id).eq("subject_id", personId);
  if (error) return { ok: false, error: "Couldn't undo right now." };
  await bumpSuggestionVersion(user.id);
  return { ok: true };
}

/**
 * Say hi — a one-tap wave in the friend's chat. The same gate as any direct message (blocks, their
 * message setting), the same idempotency (`clientId`, made once per friend per page and reused on a
 * retry, so a double tap or a retry sends ONE wave), and the same push as a chat message, after the
 * response.
 */
export async function sayHiAction(friendId: string, clientId: string): Promise<FriendActionOutcome> {
  if (!id.safeParse(friendId).success || !id.safeParse(clientId).success) return { ok: false, error: "Couldn't say hi." };
  const { user } = await viewer();
  if (!user) return { ok: false, error: "Sign in first." };
  const { success } = await assistantLimiter.limit(`hi:${user.id}`);
  if (!success) return { ok: false, error: "Slow down a little and try again." };
  const conv = await getOrCreateConversation(user.id, friendId);
  if (!conv.ok) return { ok: false, error: "They aren't taking messages right now." };
  const sent = await sendMessage(user.id, conv.id, "Hi 👋", { clientId, metadata: { kind: "say_hi" } });
  if (!sent.ok) return { ok: false, error: "Couldn't say hi right now." };
  if (!sent.duplicate) {
    const senderId = user.id;
    const conversationId = conv.id;
    after(() => notifyHi(friendId, senderId, conversationId));
  }
  return { ok: true, conversationId: conv.id };
}

async function notifyHi(toId: string, fromId: string, conversationId: string): Promise<void> {
  try {
    const { data: actor } = await createAdminClient().from("profiles").select("display_name, handle, avatar_url").eq("id", fromId).maybeSingle();
    const name = (actor?.display_name as string) || (actor?.handle ? `@${actor.handle as string}` : "A friend");
    await sendSmartPush(
      toId,
      {
        title: name,
        body: "Hi 👋",
        genericBody: "New message",
        url: `${SITE_URL}/messages/${conversationId}`,
        icon: (actor?.avatar_url as string | null) ?? undefined,
        tag: `msg:${conversationId}`,
        conversationId,
      },
      "high",
      "social",
      { recorded: { type: "message", conversationId, actorId: fromId } },
    );
  } catch (e) {
    console.warn("[friends/say-hi] push failed — the message is saved", { error: e instanceof Error ? e.name : "unknown" });
  }
}
