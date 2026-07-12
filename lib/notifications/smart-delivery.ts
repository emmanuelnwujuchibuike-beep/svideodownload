import { isOverPushFrequencyCap } from "@/lib/notifications/frequency-limit";
import { computeShouldPush, getNotificationSettings } from "@/lib/social/notification-settings";
import type { NotificationCategory } from "@/lib/social/notifications";
import { getOwnPresenceStatus } from "@/lib/social/presence-status";
import type { PushPayload } from "@/lib/push/web-push";
import { sendPushToUser } from "@/lib/push/web-push";

/**
 * Priority-tiered, presence-aware push delivery — the real, buildable slice
 * of Part 4's "Smart Delivery" section, extended in Part 6 to also honor the
 * recipient's own Notification Settings (master/push switch, per-category
 * push toggle, quiet hours). `critical` always goes through (security
 * alerts — Part 6's settings can't turn these off either, see
 * computeShouldPush); `high` (direct messages, mentions, replies) always
 * goes through too, matching how iMessage/WhatsApp still surface a DM or
 * mention during Do Not Disturb; `medium`/`low` (group chatter, suggestions)
 * are held back while the recipient has manually set themselves to DND
 * (see [[presence-status]] from Part 3) OR while Part 6's quiet hours are
 * active for a non-exempt category — still delivered in-app via Realtime +
 * the Notification Center either way, just not pushed to the lock screen.
 *
 * Deliberately NOT a queue/scheduler — "delay slightly" / "battery
 * optimization" / "network optimization" from the spec are what the OS
 * push service (APNs/FCM) already does once a payload is handed off with
 * the right urgency (see web-push.ts's own `urgency`/`topic` handling);
 * re-implementing that here would just be a slower, worse copy of what the
 * platform already provides.
 */
export type PushPriority = "critical" | "high" | "medium" | "low";

export async function sendSmartPush(userId: string, payload: PushPayload, priority: PushPriority, category: NotificationCategory): Promise<void> {
  const settings = await getNotificationSettings(userId);
  // "Hide push preview" (Part 6 privacy toggle) — swap in the caller-supplied
  // generic body ("New message") instead of the real text, applied uniformly
  // regardless of which priority branch below actually sends.
  const deliver: PushPayload = settings.hidePushPreview && payload.genericBody ? { ...payload, body: payload.genericBody } : payload;

  if (priority === "critical") {
    await sendPushToUser(userId, deliver);
    return;
  }
  if (priority === "high") {
    // Still honors the master/push/category switches (a user who turned
    // messages off entirely shouldn't get pushed just because it's a DM),
    // but never quiet-hours-gated — matches the existing DND-bypass intent.
    if (!settings.masterEnabled || !settings.pushEnabled) return;
    const pref = settings.categoryPrefs[category];
    if (pref && (!pref.enabled || !pref.push)) return;
    await sendPushToUser(userId, deliver);
    return;
  }
  const status = await getOwnPresenceStatus(userId);
  if (status === "dnd") return; // in-app delivery still happens via Realtime/Notification Center
  const nowUtcHour = new Date().getUTCHours();
  if (!computeShouldPush(settings, category, nowUtcHour)) return;
  // Part 8 fatigue reduction — only for medium/low, same carve-out as
  // everything else in this branch; a generous safety-net cap, not a tight
  // limiter (see frequency-limit.ts's own reasoning + fail-open behavior).
  if (await isOverPushFrequencyCap(userId)) return;
  await sendPushToUser(userId, deliver);
}
