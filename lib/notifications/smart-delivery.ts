import { isOverPushFrequencyCap } from "@/lib/notifications/frequency-limit";
import { computeShouldPush, getNotificationSettings } from "@/lib/social/notification-settings";
import type { NotificationCategory } from "@/lib/social/notifications";
import { getOwnPresenceStatus } from "@/lib/social/presence-status";
import type { NotificationType } from "@/lib/platform/notifications-registry";
import type { PushPayload } from "@/lib/push/web-push";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Priority-tiered, presence-aware push delivery — the real, buildable slice
 * of Part 4's "Smart Delivery" section, extended in Part 6 to also honor the
 * recipient's own Notification Settings (master/push switch, per-category
 * push toggle, quiet hours).
 *
 * DND MEANS NO PUSH — owner, 2026-07-16: "do not disturb doesnt send push
 * notification." This used to hold back only `medium`/`low` and deliberately let
 * `high` (DMs, mentions, replies) through, on the reasoning that iMessage and
 * WhatsApp still surface a DM during Do Not Disturb. The owner has overridden
 * that: on this product DND is absolute. A DM to someone on DND now delivers
 * in-app (Realtime + Notification Center) and does not reach the lock screen.
 *
 * The ONE exception is `critical`, which still bypasses DND: that tier is
 * security alerts only (new sign-in, etc.), which Part 6's settings deliberately
 * can't switch off either — silently suppressing "someone just logged into your
 * account" is a safety problem, not a preference. If that should change too, it
 * changes here and nowhere else.
 *
 * Deliberately NOT a queue/scheduler — "delay slightly" / "battery
 * optimization" / "network optimization" from the spec are what the OS
 * push service (APNs/FCM) already does once a payload is handed off with
 * the right urgency (see web-push.ts's own `urgency`/`topic` handling);
 * re-implementing that here would just be a slower, worse copy of what the
 * platform already provides.
 */
export type PushPriority = "critical" | "high" | "medium" | "low";

/**
 * What to write into the Notification Center alongside the push.
 *
 * Owner, 2026-08-26: "make all users and admin push notification to be stored
 * in notification page and show and unread mark when not read."
 *
 * 🔴 REQUIRED, deliberately. Before this, a push and its in-app record were two
 * unrelated calls: `publishNotification` did both, and the eleven callers that
 * reached for `sendSmartPush` directly — every admin alert among them — sent to
 * the lock screen and left nothing behind. Nothing in the types said they had
 * to. Making this a required argument means a new caller cannot quietly repeat
 * that: it must either describe the row to write or say, in words, that it has
 * already written one.
 */
export type NotificationRecord =
  | {
      type: NotificationType;
      actorId?: string | null;
      postId?: string | null;
      conversationId?: string | null;
    }
  /** The caller already inserted the row itself (today: `publishNotification`). */
  | "already-recorded";

/**
 * Write the in-app copy.
 *
 * 🔴 Runs BEFORE every suppression branch below, and that ordering is the
 * feature. DND, quiet hours, the category toggles and the frequency cap all
 * govern the LOCK SCREEN — the module docstring says so explicitly ("delivers
 * in-app (Realtime + Notification Center) and does not reach the lock screen").
 * Recording after them would mean the quieter someone asks the app to be, the
 * less history they get, which is the opposite of what those settings mean.
 *
 * Best-effort: a failed insert must never cost the push, exactly as in
 * `publishNotification`.
 */
async function recordInApp(userId: string, payload: PushPayload, record: NotificationRecord): Promise<void> {
  if (record === "already-recorded") return;
  try {
    const db = createAdminClient();
    await db
      .from("notifications")
      .insert({
        user_id: userId,
        actor_id: record.actorId ?? null,
        type: record.type,
        post_id: record.postId ?? null,
        conversation_id: record.conversationId ?? null,
        /*
          The push's own text and destination, kept so the card can show what
          was actually sent rather than a generic label off the type, and so the
          tap lands on the exact page (see lib/notifications/destinations.ts).
          `data` already carries this shape for admin_broadcast.
        */
        data: { title: payload.title, body: payload.body, url: payload.url ?? null },
      })
      .then(undefined, () => {});
  } catch {
    /* best-effort — never block the push */
  }
}

export async function sendSmartPush(
  userId: string,
  payload: PushPayload,
  priority: PushPriority,
  category: NotificationCategory,
  record: NotificationRecord,
): Promise<void> {
  await recordInApp(userId, payload, record);

  const settings = await getNotificationSettings(userId);
  // "Hide push preview" (Part 6 privacy toggle) — swap in the caller-supplied
  // generic body ("New message") instead of the real text, applied uniformly
  // regardless of which priority branch below actually sends.
  const deliver: PushPayload = settings.hidePushPreview && payload.genericBody ? { ...payload, body: payload.genericBody } : payload;

  // Security alerts only — the sole tier that outranks DND. See the note above.
  if (priority === "critical") {
    await sendPushToUser(userId, deliver);
    return;
  }

  // Checked BEFORE the priority split, so DND holds back `high` (DMs, mentions)
  // exactly as it holds back the rest. It used to sit inside the medium/low
  // branch only, which is why Do Not Disturb still pushed every DM through.
  // In-app delivery is unaffected — Realtime and the Notification Center still
  // get it; this only governs the lock screen.
  if ((await getOwnPresenceStatus(userId)) === "dnd") return;

  if (priority === "high") {
    // Still honors the master/push/category switches (a user who turned
    // messages off entirely shouldn't get pushed just because it's a DM),
    // but never quiet-hours-gated — a DM is what quiet hours are meant to let
    // through, and DND above is now the switch for silencing it.
    if (!settings.masterEnabled || !settings.pushEnabled) return;
    const pref = settings.categoryPrefs[category];
    if (pref && (!pref.enabled || !pref.push)) return;
    await sendPushToUser(userId, deliver);
    return;
  }
  const nowUtcHour = new Date().getUTCHours();
  if (!computeShouldPush(settings, category, nowUtcHour)) return;
  // Part 8 fatigue reduction — only for medium/low, same carve-out as
  // everything else in this branch; a generous safety-net cap, not a tight
  // limiter (see frequency-limit.ts's own reasoning + fail-open behavior).
  if (await isOverPushFrequencyCap(userId)) return;
  await sendPushToUser(userId, deliver);
}
