import { holdLabel, quietHourNow } from "@/lib/notifications/attention";
import { defaultPriorityFor } from "@/lib/notifications/priority";
import type { NotificationType } from "@/lib/platform/notifications-registry";
import { sendPushToUser } from "@/lib/push/web-push";
import { getNotificationSettings, isWithinQuietHours } from "@/lib/social/notification-settings";
import { presenceHold } from "@/lib/social/presence/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DELIVER LATER — one summary when a hold ends (Feature 20, Smart Delivery Windows)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A push held by Do Not Disturb, a focus mode or quiet hours was recorded as
 * `delivery = 'held'` (lib/notifications/smart-delivery.ts). When the hold is
 * over, the member gets ONE push — "While Sleep focus was on: 3 messages and
 * 2 comments" — and those rows are stamped `summarized_at`, so it never repeats.
 *
 *   · only HIGH and MEDIUM priority rows count: a morning push about likes is
 *     the engagement-bait the brief rules out
 *   · rows already READ in the app are skipped — nobody is told about what they saw
 *   · rows older than 48 h are dropped quietly (a summary of last week is noise)
 *   · `held_summary_enabled` off → the rows are stamped and nothing is sent
 *
 * 🔴 Cost: this runs INSIDE the existing hourly streak-reminders invocation
 * (app/api/cron/streak-reminders), adding no function invocation. When nothing
 * is held it is one indexed read (notifications_held_open_idx, 0233). Before
 * 0233 exists that read errors and the sweep returns at once.
 */
const MAX_ROWS = 2_000;
const MAX_USERS = 100; // inside a 60 s invocation shared with the streak sweep
const WINDOW_MS = 48 * 60 * 60_000;

const NOUN: Partial<Record<NotificationType, [string, string]>> = {
  message: ["message", "messages"],
  message_mention: ["mention in a chat", "mentions in chats"],
  mention: ["mention", "mentions"],
  comment: ["comment", "comments"],
  reply: ["reply", "replies"],
  friend_request: ["friend request", "friend requests"],
  friend_accepted: ["accepted friend request", "accepted friend requests"],
  community_invite: ["community invite", "community invites"],
  community_announcement: ["community announcement", "community announcements"],
  download_complete: ["finished download", "finished downloads"],
  download_ready: ["finished download", "finished downloads"],
  member_joined: ["new member", "new members"],
};

/** Pure: "3 messages, 2 comments and 1 other update". Null when nothing counts. */
export function summarizeHeld(types: readonly NotificationType[], everyPriority = false): string | null {
  const counts = new Map<string, { n: number; forms: [string, string] }>();
  let other = 0;
  for (const t of types) {
    const p = defaultPriorityFor(t);
    // a member's "summary" rule asked for these — every priority counts then
    if (!everyPriority && p !== "high" && p !== "medium") continue;
    const forms = NOUN[t];
    if (!forms) {
      other += 1;
      continue;
    }
    const key = forms[1];
    const c = counts.get(key) ?? { n: 0, forms };
    c.n += 1;
    counts.set(key, c);
  }
  const parts = [...counts.values()].sort((a, b) => b.n - a.n).map((c) => `${c.n} ${c.n === 1 ? c.forms[0] : c.forms[1]}`);
  if (other) parts.push(`${other} other ${other === 1 ? "update" : "updates"}`);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "While Sleep focus was on" — from the most common hold among the rows. */
export function summaryTitle(reasons: readonly (string | null)[]): string {
  const tally = new Map<string, number>();
  for (const r of reasons) if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const label = top ? holdLabel([top]) : null;
  if (!label) return "While you were away";
  return label === "quiet hours" ? "While quiet hours were on" : `While ${label} was on`;
}

type HeldRow = { id: string; user_id: string; type: NotificationType; delivery_reason: string | null; created_at: string };

export async function runHeldSummaries(now = new Date()): Promise<{ users: number; sent: number; waiting: number; skipped: number }> {
  const out = { users: 0, sent: 0, waiting: 0, skipped: 0 };
  const db = createAdminClient();
  const { data, error } = await db
    .from("notifications")
    .select("id, user_id, type, delivery_reason, created_at")
    .eq("delivery", "held")
    .is("summarized_at", null)
    .eq("read", false)
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error || !data?.length) return out;

  const byUser = new Map<string, HeldRow[]>();
  for (const r of data as HeldRow[]) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const stamp = (ids: string[]) => db.from("notifications").update({ summarized_at: now.toISOString() }).in("id", ids).then(undefined, () => null);

  for (const [userId, rows] of [...byUser.entries()].slice(0, MAX_USERS)) {
    out.users += 1;
    const fresh = rows.filter((r) => now.getTime() - Date.parse(r.created_at) <= WINDOW_MS);
    const stale = rows.filter((r) => !fresh.includes(r)).map((r) => r.id);
    if (stale.length) await stamp(stale);
    if (!fresh.length) continue;

    const settings = await getNotificationSettings(userId);
    if (!settings.heldSummaryEnabled || !settings.masterEnabled || !settings.pushEnabled) {
      await stamp(fresh.map((r) => r.id));
      out.skipped += 1;
      continue;
    }
    const ruled = fresh.every((r) => r.delivery_reason === "rule_summary");
    // still held? wait for the next hour (a rule's hourly summary has no hold to wait for)
    if (!ruled && (await presenceHold(userId, now)).holds) {
      out.waiting += 1;
      continue;
    }
    if (fresh.some((r) => r.delivery_reason === "quiet_hours") && settings.quietHoursEnabled && isWithinQuietHours(quietHourNow(now, settings.quietHoursTz), settings.quietHoursStartUtc, settings.quietHoursEndUtc)) {
      out.waiting += 1;
      continue;
    }

    const body = summarizeHeld(fresh.map((r) => r.type), ruled);
    await stamp(fresh.map((r) => r.id));
    if (!body) {
      out.skipped += 1;
      continue;
    }
    // the low-level sender, so "hide push preview" is applied here (sendSmartPush would do it, but would also record a row)
    await sendPushToUser(userId, {
      title: ruled ? "Your hourly summary" : summaryTitle(fresh.map((r) => r.delivery_reason)),
      body: settings.lockScreen !== "full" ? "You have updates waiting." : `${body}. Tap to catch up.`,
      ...(settings.lockScreen === "hidden" ? { title: "Frenz" } : {}),
      url: "/notifications?view=held",
      tag: "held-summary",
    }).catch(() => null);
    out.sent += 1;
  }
  return out;
}
