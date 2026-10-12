import { defaultPriorityFor } from "@/lib/notifications/priority";
import type { PushPriority } from "@/lib/notifications/smart-delivery";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { categoryForType, type NotificationType } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Part 9 — the "notification platform" this app actually needs, not an
 * event-bus/webhook/SDK enterprise platform with zero real external
 * consumers (see docs/NOTIFICATIONS_PLATFORM.md for the full scoping
 * reasoning). ONE function any feature can call instead of hand-rolling its
 * own `notifications` insert + push call: it resolves the category, applies
 * a sensible default priority (lib/notifications/priority.ts) unless
 * overridden, creates the DB row (best-effort — a failed insert never
 * blocks the push), and sends the push through the existing Part 6/7/8
 * pipeline (settings-aware, frequency-capped, logged, retried).
 *
 * Existing call sites (the follow/like/save DB triggers, lib/social/messages.ts,
 * lib/social/friends.ts, lib/social/broadcasts.ts) are deliberately NOT
 * migrated to this function in this round — each already works, uses a
 * different push mechanism, and migrating ~20 call sites in one pass during
 * a round that's specifically supposed to be careful and mistake-free is the
 * wrong trade. New features (Part 8's milestone notifications) use this from
 * day one; consolidating the rest is a real, identified, explicitly-deferred
 * follow-up — see docs/NOTIFICATIONS_PLATFORM.md.
 */
export interface PublishNotificationInput {
  /** Recipient. */
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  postId?: string | null;
  conversationId?: string | null;
  /** Omit to create an in-app-only notification (no push). */
  push?: {
    title: string;
    body: string;
    /** Shown instead of `body` when the recipient has "hide push preview" on. */
    genericBody?: string;
    url?: string;
    icon?: string;
    tag?: string;
    actions?: { action: string; title: string }[];
  };
  /** Overrides lib/notifications/priority.ts's default for this type. */
  priority?: PushPriority;
}

export async function publishNotification(input: PublishNotificationInput): Promise<void> {
  const category = categoryForType(input.type);

  /*
    Feature 20: with a push, the row is written by sendSmartPush itself, carrying
    the Attention Engine's decision (pushed / held / in_app and why) — one insert
    path, so a held push can be summarised later and explained on its card.
  */
  if (input.push) {
    const priority = input.priority ?? defaultPriorityFor(input.type);
    await sendSmartPush(
      input.userId,
      {
        title: input.push.title,
        body: input.push.body,
        genericBody: input.push.genericBody,
        url: input.push.url,
        icon: input.push.icon,
        tag: input.push.tag,
        actions: input.push.actions,
        conversationId: input.conversationId ?? undefined,
        actorId: input.actorId ?? undefined,
      },
      priority,
      category,
      { type: input.type, actorId: input.actorId ?? null, postId: input.postId ?? null, conversationId: input.conversationId ?? null },
    );
    return;
  }

  // In-app only — best-effort DB row — `.then()` is load-bearing (Supabase's query builder
  // is a lazy thenable; see the [[sw-swx-duplicate-const-bug]] memory), and a
  // failed insert must never break the caller.
  try {
    const db = createAdminClient();
    await db
      .from("notifications")
      .insert({
        user_id: input.userId,
        actor_id: input.actorId ?? null,
        type: input.type,
        post_id: input.postId ?? null,
        conversation_id: input.conversationId ?? null,
        data: null,
      })
      .then(undefined, () => {});
  } catch {
    /* best-effort */
  }
}
