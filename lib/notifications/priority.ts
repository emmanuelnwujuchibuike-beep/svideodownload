import type { NotificationType } from "@/lib/social/notifications";
import type { PushPriority } from "@/lib/notifications/smart-delivery";

/**
 * Part 8 "Smart Prioritization" — a real, static priority-by-type table
 * (not a learned/ML ranking — nothing in this app trains on engagement data,
 * and pretending otherwise would be exactly the kind of fake "AI" this
 * project has consistently avoided building). Mirrors the spec's own
 * Highest/Medium/Low buckets closely:
 *
 *   critical — account/security, payments (never held back, ever)
 *   high     — messages, friend requests, downloads finished (spec's own
 *              "Highest Priority" bucket)
 *   medium   — comments, mentions, replies, community/creator activity
 *   low      — passive social signals (follow/like/save/share/view),
 *              marketing-adjacent (news, renewal reminders)
 *
 * `sendSmartPush` already had a caller-supplied `priority` argument before
 * this (Part 4/6) — this table is what a NEW caller should default to via
 * `publishNotification()` (lib/notifications/publish.ts) rather than
 * picking priority ad hoc per call site. Existing call sites
 * (app/api/messages/route.ts, lib/social/broadcasts.ts) already compute
 * their own priority with equivalent reasoning and are left as-is — not
 * migrated to read this table, to avoid touching two already-correct,
 * already-live call sites during this round (see docs/NOTIFICATIONS_PLATFORM.md).
 */
const PRIORITY_BY_TYPE: Partial<Record<NotificationType, PushPriority>> = {
  // critical — never held back by quiet hours or DND
  security_login: "critical",
  security_new_device: "critical",
  security_password: "critical",
  security_2fa: "critical",
  security_suspicious: "critical",
  security_recovery: "critical",
  security_2fa_disabled: "critical",
  security_recovery_used: "critical",
  security_passkey_enrolled: "critical",
  security_passkey_removed: "critical",
  payment_successful: "critical",
  subscription_activated: "critical",

  // high — the spec's own "Highest Priority" bucket
  message: "high",
  message_mention: "high",
  friend_request: "high",
  friend_accepted: "high",
  download_complete: "high",
  download_ready: "high",
  milestone: "high", // celebratory — meant to feel immediate, not held back

  // medium — the spec's "Medium Priority" bucket
  comment: "medium",
  reply: "medium",
  mention: "medium",
  tag: "medium",
  quote: "medium",
  comment_reaction: "medium",
  message_reaction: "medium",
  repost_engagement: "medium",
  community_invite: "medium",
  community_accepted: "medium",
  community_announcement: "medium",
  community_event: "medium",
  processing_finished: "medium",
  download_failed: "medium",
  premium_expiring: "medium",
  friend_reminder: "medium",
  admin_broadcast: "high", // owner-sent, already high at its one call site — kept consistent here

  // low — passive/marketing-adjacent, the spec's "Low Priority" bucket
  follow: "low",
  like: "low",
  love: "low",
  repost: "low",
  share: "low",
  save: "low",
  profile_view: "low",
  invite: "low",
  news_breaking: "low",
  news_trending: "low",
  news_following: "low",
  news_recommended: "low",
  renewal_reminder: "low",
  system: "low",
};

/** The default priority for a notification type not given an explicit
 * override — falls back to "medium" for anything unmapped (a safe middle
 * ground: never silently critical, never silently swallowed like "low"
 * could be during quiet hours). */
export function defaultPriorityFor(type: NotificationType): PushPriority {
  return PRIORITY_BY_TYPE[type] ?? "medium";
}
