import { capMatters, decideDelivery, type AttentionResult, type PresenceHold, type PushPriority, quietHourNow } from "@/lib/notifications/attention";
import { isOverPushFrequencyCap } from "@/lib/notifications/frequency-limit";
import { lockScreenPayload, matchRule, rulesNeed } from "@/lib/notifications/rules";
import { smartCategoryOf, type SmartCategory } from "@/lib/notifications/smart-category";
import { getNotificationSettings, type NotificationSettings } from "@/lib/social/notification-settings";
import type { NotificationCategory } from "@/lib/social/notifications";
import { presenceHold } from "@/lib/social/presence/server";
import type { NotificationType } from "@/lib/platform/notifications-registry";
import type { PushPayload } from "@/lib/push/web-push";
import { sendPushToUser } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Priority-tiered, presence-aware push delivery (Parts 4–8), now decided by the
 * Attention Engine (Feature 20, lib/notifications/attention.ts) so every decision
 * carries a reason the member can read on their own card.
 *
 * The RULES are unchanged and live in `decideDelivery`:
 *   · critical (security, payments) always pushes — even through Do Not Disturb
 *   · DND or a focus mode that holds pushes holds EVERYTHING else (owner,
 *     2026-07-16: "do not disturb doesnt send push notification")
 *   · high (DMs, mentions, requests) obeys the switches but not quiet hours
 *   · medium/low obey quiet hours (now in the member's own time zone once saved)
 *     and the 30/hour burst cap
 *   · new, opt-in: a favourite friend may reach the lock screen during quiet hours
 *
 * Deliberately NOT a queue/scheduler for the push itself — "delay slightly" /
 * "battery optimization" are what the OS push service already does with the
 * payload's urgency (web-push.ts). What waits is the MEMBER's attention: a held
 * push is recorded as `held`, and one summary arrives when the hold ends
 * (lib/notifications/held-summary.ts).
 */
export type { PushPriority };

/**
 * What to write into the Notification Center alongside the push.
 *
 * Owner, 2026-08-26: "make all users and admin push notification to be stored
 * in notification page and show and unread mark when not read."
 *
 * 🔴 REQUIRED, deliberately: a new caller must either describe the row to write,
 * or say in words that one already exists.
 *   · { type, … }            write the row here, WITH the delivery decision
 *   · { recorded: { … } }    a database trigger already wrote it (messages); when the
 *                            push is held or kept in-app, the decision is stamped on
 *                            that row so it can be summarised and explained
 *   · "already-recorded"     written elsewhere; nothing is stamped
 */
export type NotificationRecord =
  | {
      type: NotificationType;
      actorId?: string | null;
      postId?: string | null;
      conversationId?: string | null;
    }
  | { recorded: { type: NotificationType; conversationId?: string | null; actorId?: string | null } }
  | "already-recorded";

// 0233's columns (delivery, delivery_reason) — the owner applies migrations by hand
let deliveryColumns: boolean | null = null;
const missingColumn = (m: string | undefined) => !!m && /column|schema cache/i.test(m);

/**
 * Write the in-app copy — ALWAYS, whatever the decision (the quieter someone asks
 * the app to be, the more it keeps for them, never less). Best-effort: a failed
 * insert must never cost the push.
 */
async function recordInApp(userId: string, payload: PushPayload, record: Exclude<NotificationRecord, "already-recorded" | { recorded: unknown }>, outcome: AttentionResult, ref: string | null = null): Promise<void> {
  try {
    const db = createAdminClient();
    const base = {
      user_id: userId,
      actor_id: record.actorId ?? null,
      type: record.type,
      post_id: record.postId ?? null,
      conversation_id: record.conversationId ?? null,
      /*
        The push's own text and destination, kept so the card can show what
        was actually sent rather than a generic label off the type, and so the
        tap lands on the exact page (see lib/notifications/destinations.ts).
      */
      data: { title: payload.title, body: payload.body, url: payload.url ?? null, ...(ref ? { ref } : {}) },
    };
    if (deliveryColumns !== false) {
      const { error } = await db.from("notifications").insert({ ...base, delivery: outcome.decision === "push" ? "pushed" : outcome.decision, delivery_reason: outcome.reasons[0] ?? null });
      if (!error) {
        deliveryColumns = true;
        return;
      }
      if (!missingColumn(error.message)) return;
      deliveryColumns = false;
    }
    await db.from("notifications").insert(base).then(undefined, () => {});
  } catch {
    /* best-effort — never block the push */
  }
}

/** A trigger-written row (a DM): stamp the newest matching one that has no decision yet. Only for held / in-app outcomes. */
async function stampRecorded(userId: string, match: { type: NotificationType; conversationId?: string | null; actorId?: string | null }, outcome: AttentionResult): Promise<void> {
  if (outcome.decision === "push" || deliveryColumns === false) return;
  try {
    const db = createAdminClient();
    let q = db
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", match.type)
      .is("delivery", null)
      .gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (match.conversationId) q = q.eq("conversation_id", match.conversationId);
    if (match.actorId) q = q.eq("actor_id", match.actorId);
    const { data, error } = await q;
    if (error) {
      if (missingColumn(error.message)) deliveryColumns = false;
      return;
    }
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (id) await db.from("notifications").update({ delivery: outcome.decision, delivery_reason: outcome.reasons[0] ?? null }).eq("id", id).eq("user_id", userId);
  } catch {
    /* best-effort */
  }
}

/** Is the actor in the recipient's Close friends circle (0217 social_circles kind close_friends)? Read only when a rule asks. */
async function isCloseFriend(userId: string, actorId: string): Promise<boolean> {
  try {
    const db = createAdminClient();
    const { data: circles } = await db.from("social_circles").select("id").eq("owner_id", userId).eq("kind", "close_friends").limit(1);
    const id = (circles as { id: string }[] | null)?.[0]?.id;
    if (!id) return false;
    const { data } = await db.from("circle_members").select("member_id").eq("circle_id", id).eq("member_id", actorId).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** The smart group for a rule: from the type when known, else from the category. */
function groupOf(type: NotificationType | null, category: NotificationCategory): SmartCategory {
  if (type) return smartCategoryOf(type, category);
  return category === "news" ? "content" : category === "premium" ? "earnings" : category;
}

async function isFavorite(userId: string, actorId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("friend_favorites").select("friend_id").eq("user_id", userId).eq("friend_id", actorId).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Decide with the fewest reads: the favourite check runs only when quiet hours are
 * what held it and the member allows favourites through; the burst-cap COUNT runs
 * only when the answer would otherwise be a medium/low push.
 */
export async function decideFor(userId: string, priority: PushPriority, category: NotificationCategory, actorId: string | null, settings?: NotificationSettings, now = new Date(), type: NotificationType | null = null): Promise<AttentionResult> {
  const s = settings ?? (await getNotificationSettings(userId));
  const hold: PresenceHold = priority === "critical" ? { holds: false } : await presenceHold(userId, now);
  // Part 5: the member's Delivery Rules — relationship lookups only when a rule actually names one
  let rule: ReturnType<typeof matchRule> = null;
  if (s.rules.length && priority !== "critical" && !hold.holds) {
    const need = rulesNeed(s.rules);
    const [fav, close] = await Promise.all([need.favorites && actorId ? isFavorite(userId, actorId) : false, need.closeFriends && actorId ? isCloseFriend(userId, actorId) : false]);
    rule = matchRule(s.rules, { group: groupOf(type, category), critical: false, favorite: fav, closeFriend: close });
  }
  const base = { priority, category, settings: s, hold, quietHour: quietHourNow(now, s.quietHoursTz), favorite: false, overCap: false, rule: rule?.then ?? null };
  let out = decideDelivery(base);
  if (out.reasons[0] === "quiet_hours" && s.favoritesBypassQuiet && actorId && (await isFavorite(userId, actorId))) {
    base.favorite = true;
    out = decideDelivery(base);
  }
  if (out.decision === "push" && capMatters(priority, hold) && (await isOverPushFrequencyCap(userId))) {
    base.overCap = true;
    out = decideDelivery(base);
  }
  return out;
}

/** FZ- and 8 characters a person can read back without confusing 0/O or 1/I. */
export function securityRef(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `FZ-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

export async function sendSmartPush(
  userId: string,
  payload: PushPayload,
  priority: PushPriority,
  category: NotificationCategory,
  record: NotificationRecord,
  /**
   * `push: false` — the member switched this kind of alert off somewhere more specific than a category
   * (Wallet settings, 2026-10-26). It is still recorded in-app, as `category_off`, and never pushed.
   */
  opts: { push?: boolean } = {},
): Promise<void> {
  const settings = await getNotificationSettings(userId);
  const actorId = (typeof record === "object" && "recorded" in record ? record.recorded.actorId : typeof record === "object" ? record.actorId : null) ?? payload.actorId ?? null;
  const type = typeof record === "object" ? ("recorded" in record ? record.recorded.type : record.type) : null;
  const outcome = opts.push === false ? ({ decision: "in_app", reasons: ["category_off"] } as Awaited<ReturnType<typeof decideFor>>) : await decideFor(userId, priority, category, actorId, settings, new Date(), type);

  /*
    NOTIFICATION AUTHENTICITY (Feature 20 Part 7): every security notification carries a
    reference code, stored on the member's own row and shown in the push. Only Frenz can put a
    row in someone's account, so "Verify an alert" (/account/security) tells a member whether a
    message claiming to be a Frenz security alert really is one.
  */
  const ref = type && type.startsWith("security_") ? securityRef() : null;
  if (ref) payload = { ...payload, body: `${payload.body} Ref ${ref}` };

  if (record !== "already-recorded") {
    if ("recorded" in record) await stampRecorded(userId, record.recorded, outcome);
    else await recordInApp(userId, payload, record, outcome, ref);
  }
  if (outcome.decision !== "push") return;

  // Lock-screen privacy (Part 5): full, no preview (the caller's generic text), or hidden (no sender, text or photo)
  const deliver: PushPayload = lockScreenPayload(payload, settings.lockScreen);
  await sendPushToUser(userId, deliver);
}
