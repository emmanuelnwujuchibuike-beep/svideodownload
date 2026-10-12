import type { SmartCategory } from "@/lib/notifications/smart-category";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DELIVERY RULES — the member's own "when this, do that" (Feature 20 Part 5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Family → always immediate", "Likes → summary", "Content → in the app only".
 * A rule names WHAT (a smart category, or anything) and WHO (anyone, favourite
 * friends, close friends) and says what happens to the push:
 *
 *   immediate  push now — even in quiet hours (never through DND or a focus mode,
 *              owner rule 2026-07-16: DND is absolute)
 *   summary    hold it; it arrives in the next hourly catch-up summary
 *   in_app     no push at all; it waits in the Activity Center
 *
 * First match wins, in the member's order. Security and critical alerts are
 * NEVER subject to a rule — a rule can't silence "someone just signed in to your
 * account". Pure and tested (rules.test.ts); the database caps the list at 30.
 */
export type RuleGroup = SmartCategory | "any";
export type RuleFrom = "anyone" | "favorites" | "close_friends";
export type RuleAction = "immediate" | "summary" | "in_app";

export interface DeliveryRule {
  id: string;
  when: { group: RuleGroup; from: RuleFrom };
  then: RuleAction;
}

export const MAX_RULES = 30;
const GROUPS: readonly RuleGroup[] = ["any", "social", "content", "messages", "earnings", "downloads", "community", "system"];
const FROMS: readonly RuleFrom[] = ["anyone", "favorites", "close_friends"];
const ACTIONS: readonly RuleAction[] = ["immediate", "summary", "in_app"];

/** Validate whatever arrived: unknown shapes dropped, security never a target, at most 30. */
export function cleanRules(input: unknown): DeliveryRule[] {
  if (!Array.isArray(input)) return [];
  const out: DeliveryRule[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const x = r as { id?: unknown; when?: { group?: unknown; from?: unknown }; then?: unknown };
    const group = x.when?.group;
    const from = x.when?.from ?? "anyone";
    if (!GROUPS.includes(group as RuleGroup) || !FROMS.includes(from as RuleFrom) || !ACTIONS.includes(x.then as RuleAction)) continue;
    const id = typeof x.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : `r${out.length}`;
    out.push({ id, when: { group: group as RuleGroup, from: from as RuleFrom }, then: x.then as RuleAction });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

/** Does a rule need to know the sender's relationship? Then the caller looks it up — only then. */
export function rulesNeed(rules: readonly DeliveryRule[]): { favorites: boolean; closeFriends: boolean } {
  return { favorites: rules.some((r) => r.when.from === "favorites"), closeFriends: rules.some((r) => r.when.from === "close_friends") };
}

/**
 * The first rule that matches this notification, or null. Never for security or a
 * critical alert. `favorite` / `closeFriend` describe the sender (false when there is none).
 */
export function matchRule(rules: readonly DeliveryRule[], n: { group: SmartCategory; critical: boolean; favorite: boolean; closeFriend: boolean }): DeliveryRule | null {
  if (n.critical || n.group === "security") return null;
  for (const r of rules) {
    if (r.when.group !== "any" && r.when.group !== n.group) continue;
    if (r.when.from === "favorites" && !n.favorite) continue;
    if (r.when.from === "close_friends" && !n.closeFriend) continue;
    return r;
  }
  return null;
}

export const RULE_GROUP_LABEL: Record<RuleGroup, string> = {
  any: "Everything",
  social: "Social (likes, comments, follows)",
  content: "New posts from people I follow",
  messages: "Messages",
  earnings: "Earnings and payments",
  downloads: "Downloads",
  community: "Communities",
  security: "Security",
  system: "System",
};
export const RULE_FROM_LABEL: Record<RuleFrom, string> = { anyone: "from anyone", favorites: "from favourite friends", close_friends: "from close friends" };
export const RULE_ACTION_LABEL: Record<RuleAction, string> = { immediate: "Push right away", summary: "Hourly summary", in_app: "In the app only" };

/** "Messages from favourite friends → Push right away" */
export function describeRule(r: DeliveryRule): string {
  return `${RULE_GROUP_LABEL[r.when.group]}${r.when.from === "anyone" ? "" : ` ${RULE_FROM_LABEL[r.when.from]}`} → ${RULE_ACTION_LABEL[r.then]}`;
}

// ─── Lock-screen privacy ─────────────────────────────────────────────────────

export type LockScreen = "full" | "no_preview" | "hidden";

/** What a push may show on a locked screen. "hidden": no sender, no text, no photo — just that something arrived. */
export function lockScreenPayload<P extends { title: string; body: string; genericBody?: string; icon?: string }>(p: P, mode: LockScreen): P {
  if (mode === "hidden") return { ...p, title: "Frenz", body: "You have a new notification", icon: undefined };
  if (mode === "no_preview" && p.genericBody) return { ...p, body: p.genericBody };
  return p;
}
