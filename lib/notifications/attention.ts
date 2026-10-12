import type { NotificationSettings } from "@/lib/social/notification-settings";
import { getCategoryPref, isWithinQuietHours } from "@/lib/social/notification-settings";
import type { NotificationCategory } from "@/lib/platform/notifications-registry";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ATTENTION ENGINE — should this push reach the lock screen, and why
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Feature 20 Part 2 (owner brief 2026-10-11). Pure: no database, no clock of its
 * own, so every rule is pinned by a test (attention.test.ts).
 *
 * These are the rules `sendSmartPush` already applied (Parts 4–8 and the
 * owner's 2026-07-16 "DND is absolute"), lifted out unchanged so each decision
 * can carry its REASONS. Two additions, both opt-in by the member:
 *   · quiet hours are read in the member's own time zone once they save one
 *     (`quietHoursTz`); without it the hours are UTC, exactly as before
 *   · favourite friends may reach them during quiet hours (`favoritesBypassQuiet`)
 *     — never during Do Not Disturb or a focus mode
 *
 * Not a model. Nothing here learns from behaviour. "Attention score" in the
 * brief is the priority tier plus these rules, and every outcome can be said in
 * one sentence (`explainDelivery`) — which is the brief's own principle.
 *
 *   critical  → push, always (security, payments). Even DND.
 *   held      → DND or a focus mode that holds pushes, or quiet hours. The
 *               in-app row exists; a summary push may follow when the hold ends.
 *   in_app    → the member switched this off (master, push, category), or the
 *               hourly burst cap is hit. In-app only, never summarised.
 *   push      → everything else.
 */
export type PushPriority = "critical" | "high" | "medium" | "low";
export type { DeliveryDecision } from "@/lib/notifications/explain";
import type { DeliveryDecision } from "@/lib/notifications/explain";

export type ReasonCode =
  | "critical"
  | "dnd"
  | `focus:${string}`
  | "quiet_hours"
  | "favorite_through_quiet"
  | "category_always"
  | "high_ignores_quiet"
  | "master_off"
  | "push_off"
  | "category_off"
  | "burst_cap"
  | "allowed";

/** Why pushes are held right now, if they are. `focus` is a focus-mode key (sleep, meeting…). */
export type PresenceHold = { holds: false } | { holds: true; dnd: boolean; focus: string | null };

export interface AttentionInput {
  priority: PushPriority;
  category: NotificationCategory;
  settings: NotificationSettings;
  hold: PresenceHold;
  /** the hour (0-23) in the zone quiet hours are read in — see `quietHourNow` */
  quietHour: number;
  /** the actor is one of the recipient's favourite friends */
  favorite: boolean;
  /** the recipient is over the hourly burst cap (checked only when it can matter) */
  overCap: boolean;
}

export interface AttentionResult {
  decision: DeliveryDecision;
  reasons: ReasonCode[];
}

export function decideDelivery(i: AttentionInput): AttentionResult {
  // Security and payments only — the one tier above Do Not Disturb.
  if (i.priority === "critical") return { decision: "push", reasons: ["critical"] };

  // Do Not Disturb and holding focus modes are absolute for everything else (owner, 2026-07-16).
  if (i.hold.holds) return { decision: "held", reasons: [i.hold.focus ? `focus:${i.hold.focus}` : "dnd"] };

  const s = i.settings;
  if (!s.masterEnabled) return { decision: "in_app", reasons: ["master_off"] };
  if (!s.pushEnabled) return { decision: "in_app", reasons: ["push_off"] };
  const pref = getCategoryPref(s, i.category);
  if (!pref.enabled || !pref.push) return { decision: "in_app", reasons: ["category_off"] };

  if (i.priority === "high") {
    // a DM is what quiet hours are meant to let through; DND above is the switch for silencing it
    return { decision: "push", reasons: ["high_ignores_quiet"] };
  }

  const quiet = s.quietHoursEnabled && isWithinQuietHours(i.quietHour, s.quietHoursStartUtc, s.quietHoursEndUtc);
  if (quiet && i.category !== "security") {
    if (pref.alwaysDeliver) {
      // the category's own "always deliver" — still subject to the burst cap, as before
    } else if (s.favoritesBypassQuiet && i.favorite) {
      if (i.overCap) return { decision: "in_app", reasons: ["burst_cap"] };
      return { decision: "push", reasons: ["favorite_through_quiet"] };
    } else {
      return { decision: "held", reasons: ["quiet_hours"] };
    }
  }
  if (i.overCap) return { decision: "in_app", reasons: ["burst_cap"] };
  return { decision: "push", reasons: [quiet && pref.alwaysDeliver ? "category_always" : "allowed"] };
}

/** Would the burst cap change anything? Only medium/low that got this far — so the count query runs only then. */
export function capMatters(priority: PushPriority, hold: PresenceHold): boolean {
  return priority !== "critical" && priority !== "high" && !hold.holds;
}

/** The hour (0-23) quiet hours are read in: the member's zone once saved, UTC before (the pre-0233 reading). */
export function quietHourNow(now: Date, tz: string | null | undefined): number {
  if (!tz) return now.getUTCHours();
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now);
    const n = Number.parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

export { explainDelivery, holdLabel } from "@/lib/notifications/explain";
