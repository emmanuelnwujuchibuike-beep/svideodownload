import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web Push (VAPID) — sends notifications to a user's registered browsers/devices
 * even when the site is closed. Subscriptions live in `push_subscriptions`; dead
 * ones (410/404) are pruned on send. No-op unless VAPID env is configured, so the
 * app works unchanged until keys are set. Generate keys with:
 *   npx web-push generate-vapid-keys
 * and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (+ the public one
 * again as NEXT_PUBLIC_VAPID_PUBLIC_KEY for the browser). See docs/INFRASTRUCTURE.md.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:nwujuchriss@gmail.com";

export const hasWebPush = !!PUBLIC_KEY && !!PRIVATE_KEY;

let configured = false;
function ensureConfigured(): boolean {
  if (!hasWebPush) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Deep link opened on click (defaults to the app). */
  url?: string;
  icon?: string;
  /** Collapse key — a later push with the same tag replaces the previous one. */
  tag?: string;
  /** Notification action buttons (public/sw/push.js). `action` must be one of
   * the ids that public/sw/push.js's notificationclick handler recognizes —
   * an unrecognized id just falls back to a normal open/focus. */
  actions?: { action: string; title: string }[];
  /** The other user a friend-request action button acts on — lets the SW
   * call POST /api/friends/{actorId} directly without opening a window. */
  actorId?: string;
  /** Lets a message notification's Mark-as-read/Mute action buttons act on
   * the right thread directly, without opening a window (public/sw/push.js). */
  conversationId?: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Push `payload` to every device the user has registered. Best-effort and never
 * throws — a failed/expired subscription is dropped, the rest still receive it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    const subs = (data as SubRow[]) ?? [];
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const dead: string[] = [];

    // Latency: every push here is user-facing (a message, a Wow, a follow), so
    // send with Urgency: high — without it, push services treat delivery as
    // batchable and Apple in particular holds "normal" pushes on idle/locked
    // iPhones for minutes (the exact delayed-notification symptom on installed
    // PWAs). `topic` (from our collapse tag, sanitized to APNs' 32-char
    // base64url limit) lets a newer push REPLACE an older queued one instead
    // of stacking duplicates when the device reconnects. Remaining delay after
    // this is iOS platform behavior (APNs power management), not app code.
    const topic = payload.tag ? payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            {
              TTL: 60 * 60 * 24, // hold for a day if the device is offline
              urgency: "high",
              ...(topic ? { topic } : {}),
            },
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.id); // gone — prune it
        }
      }),
    );

    if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  } catch {
    /* never let push failures affect the caller */
  }
}
