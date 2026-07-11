import { getOwnPresenceStatus } from "@/lib/social/presence-status";
import type { PushPayload } from "@/lib/push/web-push";
import { sendPushToUser } from "@/lib/push/web-push";

/**
 * Priority-tiered, presence-aware push delivery — the real, buildable slice
 * of Part 4's "Smart Delivery" section. `critical` always goes through
 * (security alerts); `high` (direct messages, mentions, replies) always
 * goes through too, matching how iMessage/WhatsApp still surface a DM or
 * mention during Do Not Disturb; `medium`/`low` (group chatter, suggestions)
 * are held back while the recipient has manually set themselves to DND
 * (see [[presence-status]] from Part 3) — still delivered in-app via
 * Realtime + the Notification Center, just not pushed to the lock screen.
 *
 * Deliberately NOT a queue/scheduler — "delay slightly" / "battery
 * optimization" / "network optimization" from the spec are what the OS
 * push service (APNs/FCM) already does once a payload is handed off with
 * the right urgency (see web-push.ts's own `urgency`/`topic` handling);
 * re-implementing that here would just be a slower, worse copy of what the
 * platform already provides.
 */
export type PushPriority = "critical" | "high" | "medium" | "low";

export async function sendSmartPush(userId: string, payload: PushPayload, priority: PushPriority): Promise<void> {
  if (priority === "critical" || priority === "high") {
    await sendPushToUser(userId, payload);
    return;
  }
  const status = await getOwnPresenceStatus(userId);
  if (status === "dnd") return; // in-app delivery still happens via Realtime/Notification Center
  await sendPushToUser(userId, payload);
}
