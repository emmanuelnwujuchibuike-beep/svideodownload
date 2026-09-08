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
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@frenzsave.com";

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
  /**
   * Show the system notification even when the app is open and visible.
   *
   * 🔴 SMOKE TEST ONLY. Normally the service worker suppresses the OS
   * notification while a window is visible, because the in-app drop-down is
   * already showing that event (owner rule, 2026-07-16). A test push writes no
   * `notifications` row, so without this the tester sees nothing at all and
   * reads a working pipeline as broken. Set only by
   * /api/cron/notification-test, which is behind the cron credential.
   */
  force?: boolean;
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
  /** Marks a sponsored/ad push so the client (service worker) renders a clear
   * "Sponsored" label — the honest, professional ad marking, without ever
   * saying "this is a non-personalised generic ad". Rides in the delivered
   * payload (unlike genericBody). */
  sponsored?: boolean;
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

/*
  ═════════════════════════════════════════════════════════════════════════════
   🔴 EVERY PUSH IS BOUNDED. AN UNBOUNDED ONE TAKES ITS CALLER DOWN WITH IT.
  ═════════════════════════════════════════════════════════════════════════════

  Fixed 2026-09-08, after `/api/cron/wallpaper-reminder` failed for three
  consecutive days (GitHub Actions runs 33968061715, 34035733405, 34138218619)
  while `digest` and `streak-reminders` — same workflow shape, same credential,
  same minute — both succeeded. So it was never auth, and never the outage.

  The route's own code cannot return non-2xx: the database error is handled,
  `sendAdminAlertOnce` catches everything and `sendSmartPush` is wrapped in
  BOTH a `.catch()` and a `try`. Every path returns 200. A route that cannot
  fail was failing, which leaves exactly one candidate — it never returned at
  all, and the platform killed it.

  `webpush.sendNotification` sets NO socket timeout, and Node's https has none
  by default. One subscription whose push service accepts the TCP connection
  and then never answers holds that promise open forever; `Promise.all` waits
  for the slowest; the function exceeds its duration and the caller sees 504.
  Production has 54 subscriptions across FCM and `web.push.apple.com`, and a
  stale APNs endpoint behaving that way is ordinary, not exotic.

  🔴 The severity is not "a notification was missed". Best-effort work decided
  the HTTP status of its caller — so a dead phone silently disabled the daily
  wallpaper reminder, and would do the same to any route that ever sends a push
  inline. Three bounds, because each one alone has a hole:

    1. a SOCKET timeout, so a connection that stops speaking is destroyed
       rather than waited on (web-push 3.6.7 supports it and we never passed it);
    2. a WALL-CLOCK cap per subscription, because a socket timeout only fires
       on silence — a response dripping a byte at a time resets it forever;
    3. a WALL-CLOCK cap on the whole fan-out, so N slow devices cannot add up
       even when each one is individually within its budget.

  Sized to fit inside a serverless invocation with room to spare. Cron routes
  additionally declare `maxDuration` (vercel.json) so the budget below is the
  thing that expires first — a bound nobody reaches is not a bound.
*/

/** Destroy a push request that stops speaking for this long. */
const PUSH_SOCKET_TIMEOUT_MS = 5_000;
/** Ceiling for ONE subscription's whole sequence: attempt, backoff, retry. */
const PUSH_ATTEMPT_BUDGET_MS = 11_000;
/** Ceiling for the entire fan-out, however many devices are registered. */
const PUSH_FANOUT_BUDGET_MS = 12_000;

/**
 * Resolve with `onTimeout` if `work` has not settled in `ms`.
 *
 * The underlying request may still be in flight — we cannot abort a socket we
 * do not own — but nothing waits on it any more, which is the property that
 * matters. The timer is always cleared, so a fast path never holds the event
 * loop open behind a pending `setTimeout`.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const TIMED_OUT: SendOutcome = { ok: false, message: "timed out waiting for the push service" };

async function sendOnce(s: SubRow, body: string, topic: string | undefined): Promise<SendOutcome> {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      body,
      {
        TTL: 60 * 60 * 24, // hold for a day if the device is offline
        urgency: "high",
        // 🔴 See the block above. Without this the request can never end.
        timeout: PUSH_SOCKET_TIMEOUT_MS,
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
  return sendPushToIdentity({ kind: "user", id: userId }, payload);
}

/**
 * The same delivery for an ANONYMOUS identity (streak reminders, 2026-08-24).
 *
 * 🔴 The sender is shared, not copied. Retry, 404/410 pruning and the
 *  rows the admin monitor reads are non-trivial and hard-won;
 * a second implementation for anonymous endpoints would be a second place for a
 * stale endpoint to rot. Only the SELECT filter and the logged identity column
 * differ.
 */
export async function sendPushToAnon(anonId: string, payload: PushPayload): Promise<void> {
  return sendPushToIdentity({ kind: "anon", id: anonId }, payload);
}

type PushIdentity = { kind: "user" | "anon"; id: string };

async function sendPushToIdentity(identity: PushIdentity, payload: PushPayload): Promise<void> {
  const userId = identity.kind === "user" ? identity.id : null;
  const anonId = identity.kind === "anon" ? identity.id : null;
  if (!ensureConfigured()) return;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq(identity.kind === "user" ? "user_id" : "anon_id", identity.id);
    const subs = (data as SubRow[]) ?? [];
    if (subs.length === 0) return;

    // genericBody is a hint for THIS function's caller-facing type only —
    // never part of the actual payload delivered to the service worker.
    const { genericBody: _genericBody, ...deliverable } = payload;
    const body = JSON.stringify(deliverable);
    const dead: string[] = [];
    const logRows: {
      user_id: string | null;
      anon_id: string | null;
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

    const deliverToOne = async (s: SubRow) => {
      const first = await sendOnce(s, body, topic);
      if (first.ok) {
        logRows.push({ user_id: userId, anon_id: anonId, subscription_id: s.id, tag, status: "sent", status_code: 201, error: null, attempt: 1 });
        return;
      }
      if (first.code === 404 || first.code === 410) {
        dead.push(s.id); // gone — prune it, no retry
        logRows.push({ user_id: userId, anon_id: anonId, subscription_id: s.id, tag, status: "pruned", status_code: first.code, error: first.message ?? null, attempt: 1 });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      const retry = await sendOnce(s, body, topic);
      if (retry.ok) {
        logRows.push({ user_id: userId, anon_id: anonId, subscription_id: s.id, tag, status: "retried", status_code: 201, error: null, attempt: 2 });
      } else {
        logRows.push({
          user_id: userId,
          anon_id: anonId,
          subscription_id: s.id,
          tag,
          status: "failed",
          status_code: retry.code ?? first.code ?? null,
          error: (retry.message ?? first.message ?? null),
          attempt: 2,
        });
      }
    };

    /*
      🔴 A SLOW DEVICE IS NOT A DEAD ONE — a timeout NEVER prunes.

      404 and 410 are the push service stating the subscription is gone, which
      is knowledge. A timeout is the absence of knowledge, and deleting a real
      subscription because its owner's phone was on a bad train would silently
      unsubscribe someone who did nothing wrong. It is logged as a failure (so
      the admin push monitor can show it) and the row is left alone.
    */
    await withDeadline(
      Promise.all(
        subs.map((s) =>
          // `.catch` BEFORE the race: one subscription throwing must not reject
          // the whole `Promise.all` and cost every other device its delivery,
          // its prune and its log row.
          withDeadline(
            deliverToOne(s).catch(() => {}),
            PUSH_ATTEMPT_BUDGET_MS,
            undefined,
          ).then(() => {
            if (!logRows.some((r) => r.subscription_id === s.id)) {
              logRows.push({
                user_id: userId,
                anon_id: anonId,
                subscription_id: s.id,
                tag,
                status: "failed",
                status_code: null,
                error: TIMED_OUT.message ?? "timed out",
                attempt: 1,
              });
            }
          }),
        ),
      ),
      PUSH_FANOUT_BUDGET_MS,
      undefined,
    );

    if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
    if (logRows.length) void db.from("push_delivery_log").insert(logRows).then(() => {}, () => {});
  } catch {
    /* never let push failures affect the caller */
  }
}
