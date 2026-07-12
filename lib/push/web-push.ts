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
  /** Part 6 "hide push preview" privacy setting: shown instead of `body` when
   * the recipient has that toggle on (e.g. "New message" instead of the
   * actual text) — stripped before the payload is ever sent, never itself
   * delivered. See sendSmartPush. */
  genericBody?: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SendOutcome {
  ok: boolean;
  code?: number;
  message?: string;
}

async function sendOnce(s: SubRow, body: string, topic: string | undefined): Promise<SendOutcome> {
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
    return { ok: true };
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    const message = (err as { message?: string }).message?.slice(0, 300);
    return { ok: false, code, message };
  }
}

/**
 * Push `payload` to every device the user has registered. Best-effort and never
 * throws — a failed/expired subscription is dropped, the rest still receive it.
 *
 * Part 7 additions: a dead subscription (404/410 — the push service itself
 * says "gone") is pruned immediately, no retry (retrying a dead endpoint is
 * pure waste). Any OTHER failure (network blip, 500/503 from the push
 * service) gets ONE bounded retry after a short delay — the honest version
 * of "intelligent retry system" at this app's real scale; a full queue/
 * dead-letter/exponential-backoff scheduler would be solving a scale problem
 * this app doesn't have yet (see smart-delivery.ts's identical reasoning).
 * Every attempt (sent/retried/failed/pruned) is logged to
 * `push_delivery_log`, fire-and-forget — the source for the admin
 * "Push delivery" monitor (features/admin/push-delivery-monitor.tsx).
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

    // genericBody is a hint for THIS function's caller-facing type only —
    // never part of the actual payload delivered to the service worker.
    const { genericBody: _genericBody, ...deliverable } = payload;
    const body = JSON.stringify(deliverable);
    const dead: string[] = [];
    const logRows: {
      user_id: string;
      subscription_id: string;
      tag: string | null;
      status: "sent" | "retried" | "failed" | "pruned";
      status_code: number | null;
      error: string | null;
      attempt: number;
    }[] = [];

    // Latency: every push here is user-facing (a message, a Wow, a follow), so
    // send with Urgency: high — without it, push services treat delivery as
    // batchable and Apple in particular holds "normal" pushes on idle/locked
    // iPhones for minutes (the exact delayed-notification symptom on installed
    // PWAs). `topic` (from our collapse tag, sanitized to APNs' 32-char
    // base64url limit) lets a newer push REPLACE an older queued one instead
    // of stacking duplicates when the device reconnects. Remaining delay after
    // this is iOS platform behavior (APNs power management), not app code.
    const topic = payload.tag ? payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined;
    const tag = payload.tag ?? null;

    await Promise.all(
      subs.map(async (s) => {
        const first = await sendOnce(s, body, topic);
        if (first.ok) {
          logRows.push({ user_id: userId, subscription_id: s.id, tag, status: "sent", status_code: 201, error: null, attempt: 1 });
          return;
        }
        if (first.code === 404 || first.code === 410) {
          dead.push(s.id); // gone — prune it, no retry
          logRows.push({ user_id: userId, subscription_id: s.id, tag, status: "pruned", status_code: first.code, error: first.message ?? null, attempt: 1 });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        const retry = await sendOnce(s, body, topic);
        if (retry.ok) {
          logRows.push({ user_id: userId, subscription_id: s.id, tag, status: "retried", status_code: 201, error: null, attempt: 2 });
        } else {
          logRows.push({
            user_id: userId,
            subscription_id: s.id,
            tag,
            status: "failed",
            status_code: retry.code ?? first.code ?? null,
            error: (retry.message ?? first.message ?? null),
            attempt: 2,
          });
        }
      }),
    );

    if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
    if (logRows.length) void db.from("push_delivery_log").insert(logRows).then(() => {}, () => {});
  } catch {
    /* never let push failures affect the caller */
  }
}
